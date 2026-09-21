//! Local `get_weather` tool. The cloud server only forwards the call; this process
//! looks up the city and returns a short Chinese summary.

use serde::Deserialize;
use serde_json::{json, Value};

pub const GET_WEATHER: &str = "get_weather";

pub fn weather_tool_def() -> Value {
    json!({
        "name": GET_WEATHER,
        "description": "查询指定城市的当前天气和未来7天预报。用户询问天气、气温、降雨、风力或未来几天天气时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "城市名，例如北京、上海、深圳"
                }
            },
            "required": ["city"]
        }
    })
}

pub fn client_tools() -> Vec<Value> {
    vec![weather_tool_def()]
}

pub fn city_from_arguments(arguments: &Value) -> Result<String, String> {
    let obj = match arguments {
        Value::Object(_) => arguments.clone(),
        Value::String(raw) => serde_json::from_str(raw)
            .map_err(|_| "get_weather arguments must be an object with city".to_string())?,
        _ => return Err("get_weather arguments must be an object with city".into()),
    };
    let city = obj
        .get("city")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "get_weather requires a non-empty city".to_string())?;
    Ok(city.to_string())
}

pub async fn execute_tool(name: &str, arguments: &Value) -> Result<String, String> {
    if name != GET_WEATHER {
        return Err(format!("unsupported tool: {name}"));
    }
    let city = city_from_arguments(arguments)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    lookup_weather(&client, &city).await
}

async fn lookup_weather(client: &reqwest::Client, city: &str) -> Result<String, String> {
    let geo: GeoResponse = client
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[
            ("name", city),
            ("count", "1"),
            ("language", "zh"),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("geocoding request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("geocoding HTTP error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("geocoding JSON: {e}"))?;

    let place = geo
        .results
        .into_iter()
        .next()
        .ok_or_else(|| format!("找不到城市：{city}"))?;

    let forecast: ForecastResponse = client
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", place.latitude.to_string()),
            ("longitude", place.longitude.to_string()),
            (
                "current",
                "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m".into(),
            ),
            (
                "daily",
                "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum".into(),
            ),
            ("forecast_days", "7".into()),
            ("timezone", "auto".into()),
        ])
        .send()
        .await
        .map_err(|e| format!("forecast request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("forecast HTTP error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("forecast JSON: {e}"))?;

    let current = forecast
        .current
        .ok_or_else(|| "forecast missing current weather".to_string())?;

    let days = daily_points(forecast.daily.as_ref());
    Ok(format_report(
        &place.name,
        place.country.as_deref().unwrap_or(""),
        place.admin1.as_deref().unwrap_or(""),
        current.temperature_2m,
        current.relative_humidity_2m,
        current.wind_speed_10m,
        current.weather_code,
        &days,
    ))
}

fn daily_points(daily: Option<&DailyForecast>) -> Vec<DailyPoint> {
    let Some(daily) = daily else {
        return Vec::new();
    };
    let n = daily
        .time
        .len()
        .min(daily.weather_code.len())
        .min(daily.temperature_2m_max.len())
        .min(daily.temperature_2m_min.len());
    (0..n)
        .map(|i| DailyPoint {
            date: daily.time[i].clone(),
            code: daily.weather_code[i],
            max_c: daily.temperature_2m_max[i],
            min_c: daily.temperature_2m_min[i],
            precip_mm: daily.precipitation_sum.as_ref().and_then(|v| v.get(i).copied()),
        })
        .collect()
}

pub fn format_report(
    name: &str,
    country: &str,
    admin1: &str,
    temperature_c: f64,
    humidity: Option<f64>,
    wind_kmh: Option<f64>,
    weather_code: i64,
    days: &[DailyPoint],
) -> String {
    let place = match (admin1.is_empty(), country.is_empty()) {
        (false, false) if admin1 != name => format!("{name}（{admin1}，{country}）"),
        (_, false) => format!("{name}（{country}）"),
        _ => name.to_string(),
    };
    let mut parts = vec![
        format!(
            "{place}当前天气：{}，气温 {:.0}°C",
            weather_label(weather_code),
            temperature_c
        ),
    ];
    if let Some(h) = humidity {
        parts.push(format!("湿度 {h:.0}%"));
    }
    if let Some(w) = wind_kmh {
        parts.push(format!("风速 {w:.0} km/h"));
    }
    let mut text = parts.join("，");
    if !days.is_empty() {
        text.push_str("\n逐日预报（含今天）：");
        for day in days {
            text.push('\n');
            text.push_str(&format_day(day));
        }
    }
    text
}

pub fn format_day(day: &DailyPoint) -> String {
    let precip = day
        .precip_mm
        .filter(|mm| *mm > 0.0)
        .map(|mm| format!("，降水 {mm:.1}mm"))
        .unwrap_or_default();
    format!(
        "{} {} {:.0}–{:.0}°C{precip}",
        day.date,
        weather_label(day.code),
        day.min_c,
        day.max_c
    )
}

pub struct DailyPoint {
    pub date: String,
    pub code: i64,
    pub max_c: f64,
    pub min_c: f64,
    pub precip_mm: Option<f64>,
}

pub fn weather_label(code: i64) -> &'static str {
    match code {
        0 => "晴",
        1 => "大部晴朗",
        2 => "多云",
        3 => "阴",
        45 | 48 => "雾",
        51 | 53 | 55 | 56 | 57 => "毛毛雨",
        61 | 63 | 65 | 66 | 67 | 80 | 81 | 82 => "雨",
        71 | 73 | 75 | 77 | 85 | 86 => "雪",
        95 | 96 | 99 => "雷暴",
        _ => "未知",
    }
}

#[derive(Debug, Deserialize)]
struct GeoResponse {
    #[serde(default)]
    results: Vec<GeoPlace>,
}

#[derive(Debug, Deserialize)]
struct GeoPlace {
    name: String,
    latitude: f64,
    longitude: f64,
    country: Option<String>,
    admin1: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ForecastResponse {
    current: Option<CurrentWeather>,
    daily: Option<DailyForecast>,
}

#[derive(Debug, Deserialize)]
struct DailyForecast {
    time: Vec<String>,
    weather_code: Vec<i64>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
    precipitation_sum: Option<Vec<f64>>,
}

#[derive(Debug, Deserialize)]
struct CurrentWeather {
    temperature_2m: f64,
    relative_humidity_2m: Option<f64>,
    weather_code: i64,
    wind_speed_10m: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_city_from_object_or_json_string() {
        assert_eq!(
            city_from_arguments(&json!({"city": " 北京 "})).unwrap(),
            "北京"
        );
        assert_eq!(
            city_from_arguments(&json!(r#"{"city":"上海"}"#)).unwrap(),
            "上海"
        );
        assert!(city_from_arguments(&json!({})).is_err());
    }

    #[test]
    fn formats_report_in_chinese() {
        let days = [DailyPoint {
            date: "2026-09-22".into(),
            code: 61,
            max_c: 24.2,
            min_c: 16.6,
            precip_mm: Some(3.2),
        }];
        let text = format_report(
            "北京",
            "中国",
            "北京市",
            21.4,
            Some(40.0),
            Some(12.2),
            2,
            &days,
        );
        assert!(text.contains("北京"));
        assert!(text.contains("多云"));
        assert!(text.contains("21°C"));
        assert!(text.contains("湿度 40%"));
        assert!(text.contains("2026-09-22 雨 17–24°C，降水 3.2mm"));
        assert_eq!(weather_label(61), "雨");
        assert_eq!(weather_label(0), "晴");
    }

    #[test]
    #[ignore = "calls Open-Meteo"]
    fn live_lookup_beijing() {
        let text = tauri::async_runtime::block_on(execute_tool(
            GET_WEATHER,
            &json!({"city": "北京"}),
        ))
        .expect("weather lookup");
        assert!(text.contains("北京"), "{text}");
        assert!(text.contains("°C"), "{text}");
        eprintln!("{text}");
    }
}
