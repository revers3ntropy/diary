import { OPEN_WEATHER_MAP_API_KEY } from '$env/static/private';
import { Day } from '$lib/utils/day';
import { FileLogger } from '$lib/utils/log.server';
import { Result } from '$lib/utils/result';
import { z } from 'zod';

const logger = new FileLogger('OpenWeatherMapAPI');

const weatherForDayExpectedSchema = z.object({
    list: z.array(
        z.object({
            dt: z.number(),
            main: z.object({
                temp: z.number(),
                feels_like: z.number(),
                temp_min: z.number(),
                temp_max: z.number(),
                pressure: z.number(),
                humidity: z.number()
            }),
            wind: z
                .object({
                    speed: z.number(),
                    deg: z.number()
                })
                .default({ speed: 0, deg: 0 }),
            clouds: z
                .object({
                    all: z.number()
                })
                .default({ all: 0 }),
            weather: z.array(
                z.object({
                    id: z.number(),
                    main: z.string(),
                    description: z.string(),
                    icon: z.string()
                })
            ),
            rain: z
                .object({
                    '1h': z.number().optional(),
                    '3h': z.number().optional()
                })
                .default({ '1h': 0 }),
            snow: z
                .object({
                    '1h': z.number().optional(),
                    '3h': z.number().optional()
                })
                .default({ '1h': 0 })
        })
    )
});

export namespace OpenWeatherMapAPI {
    export type WeatherForDay = {
        temp: number;
    };

    const cache = new Map<string, WeatherForDay>();
    const numRequestsPerDay = new Map<string, number>();

    export async function getWeatherForDay(
        day: Day,
        lat: number,
        long: number
    ): Promise<Result<WeatherForDay>> {
        const cacheKey = `${day.fmtIso()}-${lat}-${long}`;
        if (cache.has(cacheKey)) {
            return Result.ok(cache.get(cacheKey));
        }
        // rate limit entire application to avoid fees from OpenWeatherMap
        // (£1.2/1000 requests after 1000 requests per day)
        const reqsToday = numRequestsPerDay.get(Day.today(0).fmtIso()) || 0;
        if (reqsToday > 900) {
            return Result.err('Cannot fetch weather data at this time');
        }
        if (!reqsToday || reqsToday < 1) {
            // memory clean up when day changes
            numRequestsPerDay.clear();
            numRequestsPerDay.set(Day.today(0).fmtIso(), 1);
        } else {
            numRequestsPerDay.set(Day.today(0).fmtIso(), reqsToday + 1);
        }

        // will work up to 1.5 years into the future,
        // but should really only be for days in the past as days in the future
        // is prediction but would display like it's a fact
        if (day.plusDays(-1).isInFuture(0)) {
            return Result.err('Cannot get weather for the future');
        }
        if (!OPEN_WEATHER_MAP_API_KEY) {
            return Result.err('Cannot fetch weather data at this time');
        }
        const apiUrl = `https://history.openweathermap.org/data/2.5/history/city?lat=${lat}&lon=${long}&date=${day.fmtIso()}&appid=${OPEN_WEATHER_MAP_API_KEY}`;
        let res;
        try {
            res = await fetch(apiUrl, {
                method: 'GET'
            });
        } catch (error) {
            await logger.warn('getWeatherForDay: Error connecting to OpenWeatherMap', {
                error,
                day,
                lat,
                long
            });
            return Result.err('Error connecting to OpenWeatherMap');
        }

        let data;
        try {
            data = await res.json();
        } catch (error) {
            let textRes = 'could not parse response';
            try {
                textRes = await res.text();
            } catch (error) {
                // ignore
            }
            await logger.error('getWeatherForDay: Invalid response from OpenWeatherMap', {
                res,
                textRes,
                error
            });
            return Result.err('Invalid response from OpenWeatherMap');
        }

        const parseResult = weatherForDayExpectedSchema.safeParse(data);

        if (!parseResult.success) {
            await logger.error(`getWeatherForDay: Invalid response from OpenWeatherMap`, { data });
            return Result.err('Invalid response from OpenWeatherMap');
        }

        const weather = {
            temp: parseResult.data.list[0].main.temp
        } satisfies WeatherForDay;

        cache.set(cacheKey, weather);
        return Result.ok(weather);
    }
}
