import asyncio
import json
import logging
import math
from collections.abc import AsyncIterator

import httpx

from trips.domain.errors import PlanningError
from trips.domain.models import Location, Route, RoutePoint
from trips.services.budget import Budget

logger = logging.getLogger("trips.provider")
_MAX_RESPONSE_BYTES = 8_000_000
_STATES = frozenset(
    "AL AZ AR CA CO CT DE FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT "
    "NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split()
)
_FACILITY_TYPES = frozenset({"fuel_station", "rest_area", "service_area"})


def invalid_response() -> PlanningError:
    return PlanningError("provider_data", "The map provider returned incomplete or invalid data. Try again.", 502)


def retry_after(value: str | None, default: int) -> int:
    try:
        return min(86_400, max(1, int(value or "")))
    except ValueError:
        return default


def number(value: object, *, minimum: float = 0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise invalid_response()
    try:
        numeric = float(value)
    except OverflowError:
        raise invalid_response() from None
    if not math.isfinite(numeric) or numeric < minimum:
        raise invalid_response()
    return numeric


def text(value: object, maximum: int = 500) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise invalid_response()
    return value.strip()


def coordinates(lon: object, lat: object) -> tuple[float, float]:
    x, y = number(lon, minimum=-180), number(lat, minimum=-90)
    if not (-125 <= x <= -66 and 24 <= y <= 50):
        raise PlanningError("unsupported_region", "Only contiguous-US road trips are supported.")
    return x, y


def parse_places(payload: dict, *, facilities: bool) -> list[Location]:
    if payload == {}:
        return []
    try:
        results = payload["results"]
        if not isinstance(results, list) or len(results) > 100:
            raise invalid_response()
        locations = []
        for item in results:
            address = item["address"]
            state = address["countrySubdivisionCodeIso"].removeprefix("US-")
            if address["countryCodeIso2"] != "US" or state not in _STATES:
                continue
            lon, lat = coordinates(*item["position"]["coordinates"])
            kinds = {entry["id"] for entry in item.get("poiTypes", [])}
            if facilities:
                eligible = kinds & _FACILITY_TYPES
                if not eligible:
                    continue
                kind = "fuel_station" if "fuel_station" in eligible else sorted(eligible)[0]
            else:
                kind = "location"
            town = address.get("municipality") or address.get("municipalitySubdivision")
            street = " ".join(str(address.get(key, "")) for key in ("houseNumber", "street")).strip()
            label = ", ".join(part for part in (street, town or "Locality not provided", state) if part)
            locations.append(Location(text(item["id"]), text(item["title"]), label, lat, lon, kind))
        return locations
    except (KeyError, TypeError, AttributeError, ValueError):
        raise invalid_response() from None


def parse_route(payload: dict, origin: Location, destination: Location) -> Route:
    try:
        routes = payload["routes"]
        if not isinstance(routes, list):
            raise invalid_response()
        if not routes:
            raise PlanningError("no_route", "No supported road route was found between these locations.")
        data = routes[0]
        meters = number(data["summary"]["lengthInMeters"])
        seconds_value = number(data["summary"]["travelTimeInSeconds"])
        if seconds_value <= 0 or meters <= 0:
            raise invalid_response()
        seconds = math.ceil(seconds_value)
        if len(data["legs"]) != 1:
            raise invalid_response()
        geometry = [coordinates(p["longitude"], p["latitude"]) for p in data["legs"][0]["points"]]
        if len(geometry) < 2 or len(geometry) > 100_000:
            raise invalid_response()
        sections = data["sections"]
        for category, field, allowed in (("COUNTRY", "countryCode", {"USA", "US"}), ("TRAVEL_MODE", "travelMode", {"truck"})):
            matching = sorted((s for s in sections if s["sectionType"] == category), key=lambda s: s["startPointIndex"])
            if not matching:
                raise invalid_response()
            end = 0
            for section in matching:
                if section[field] not in allowed:
                    raise PlanningError("unsupported_route", "The provider route leaves the US or contains a non-truck segment.")
                if section["startPointIndex"] > end or section["endPointIndex"] < end:
                    raise invalid_response()
                end = section["endPointIndex"]
            if end != len(geometry) - 1:
                raise invalid_response()
        if any(s["sectionType"] in {"FERRY", "CAR_TRAIN", "PEDESTRIAN"} for s in sections):
            raise PlanningError("unsupported_route", "Ferry, train and pedestrian route segments are not supported.")
        progress = []
        previous_index = -1
        for point in data["progress"]:
            index = point["pointIndex"]
            if type(index) is not int or not previous_index < index < len(geometry):
                raise invalid_response()
            elapsed = number(point["travelTimeInSeconds"])
            distance = number(point["distanceInMeters"])
            if elapsed > seconds or distance > meters:
                raise invalid_response()
            if progress and (elapsed < progress[-1].seconds or distance < progress[-1].meters):
                raise invalid_response()
            progress.append(RoutePoint(*geometry[index], elapsed, distance))
            previous_index = index
        if not progress or progress[0].seconds != 0 or progress[0].meters != 0:
            raise invalid_response()
        if previous_index != len(geometry) - 1 or progress[-1].seconds != seconds_value or progress[-1].meters != meters:
            raise invalid_response()
        instructions = []
        for item in data["guidance"]["instructions"]:
            instructions.append({
                "text": text(item["message"], 2000),
                "distance_meters": number(item["routeOffsetInMeters"]),
                "travel_seconds": number(item["travelTimeInSeconds"]),
                "point": coordinates(item["point"]["longitude"], item["point"]["latitude"]),
            })
        if not instructions:
            raise invalid_response()
        return Route(origin, destination, meters, seconds, geometry, instructions, progress)
    except (KeyError, TypeError, AttributeError, IndexError, ValueError):
        raise invalid_response() from None


class TomTom:
    def __init__(self, key: str, budget: Budget, *, transport: httpx.AsyncBaseTransport | None = None):
        if not key:
            raise PlanningError("provider_not_configured", "Configure TOMTOM_API_KEY in backend/.env to enable planning.", 503)
        self.key = key
        self.budget = budget
        self.client = httpx.AsyncClient(transport=transport, follow_redirects=False, trust_env=False)
        self._runner = asyncio.Runner()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        try:
            self._runner.run(self.client.aclose())
        finally:
            self._runner.close()

    def _request(self, method: str, path: str, *, params: list[tuple[str, str]] | None = None, body: dict | None = None) -> dict:
        return self._runner.run(self._request_async(method, path, params=params, body=body))

    @staticmethod
    async def _body_chunks(response: httpx.Response) -> AsyncIterator[bytes]:
        if response.is_stream_consumed:
            yield response.content
        else:
            async for chunk in response.aiter_raw():
                yield chunk

    async def _request_async(self, method: str, path: str, *, params: list[tuple[str, str]] | None = None, body: dict | None = None) -> dict:
        self.budget.check()
        headers = {"Accept": "application/json", "Accept-Encoding": "identity"}
        query = list(params or [])
        if body is not None:
            headers.update({
                "TomTom-Api-Key": self.key,
                "TomTom-Api-Version": "3",
                "Attributes": "results(id,type,title,position,address,poiTypes)",
            })
        else:
            query.append(("key", self.key))
        for attempt in range(2):
            remaining = self.budget.request()
            try:
                remaining = self.budget.check()
                deadline = asyncio.timeout(remaining)
                async with deadline, self.client.stream(
                    method, "https://api.tomtom.com" + path, params=query, json=body,
                    headers=headers, timeout=min(15, remaining),
                ) as response:
                    status = response.status_code
                    if status in {401, 403}:
                        raise PlanningError("provider_credentials", "The TomTom key is invalid or is not enabled for a required service.", 503)
                    if status == 429:
                        raise PlanningError(
                            "provider_quota",
                            "TomTom's request quota or rate limit was reached. Try later.",
                            429,
                            retry_after=retry_after(response.headers.get("Retry-After"), 60),
                        )
                    if status >= 500 and attempt == 0:
                        continue
                    routing_error = status == 400 and method == "GET" and path.startswith("/routing/1/calculateRoute/")
                    if status != 200 and not routing_error:
                        raise PlanningError("provider_failure", "TomTom could not complete the request.", 502)
                    if response.headers.get("Content-Encoding", "identity").strip().lower() not in {"", "identity"}:
                        raise invalid_response()
                    content = bytearray()
                    async for chunk in self._body_chunks(response):
                        self.budget.check()
                        if len(content) + len(chunk) > _MAX_RESPONSE_BYTES:
                            raise PlanningError("provider_data_limit", "The provider response exceeds the supported size.", 502)
                        content.extend(chunk)
                    try:
                        payload = json.loads(content)
                    except (ValueError, UnicodeDecodeError):
                        raise invalid_response() from None
                    if not isinstance(payload, dict):
                        raise invalid_response()
                    self.budget.check()
                    if routing_error:
                        detail = payload.get("detailedError")
                        if isinstance(detail, dict) and detail.get("code") in ("NO_ROUTE_FOUND", "MAP_MATCHING_FAILURE"):
                            raise PlanningError("no_route", "No supported road route was found between these locations.")
                        raise PlanningError("provider_failure", "TomTom could not complete the request.", 502)
                    return payload
            except TimeoutError:
                if deadline.expired():
                    raise self.budget.timeout_error() from None
                raise
            except httpx.TimeoutException:
                self.budget.check()
                raise PlanningError("provider_timeout", "The map provider timed out. Try again.", 504) from None
            except httpx.RequestError:
                raise PlanningError("provider_unavailable", "The map provider could not be reached.", 502) from None
        raise PlanningError("provider_unavailable", "The map provider is temporarily unavailable.", 502)

    def lookup(self, query: str) -> list[Location]:
        payload = self._request("POST", "/maps/orbis/places/discover", body={
            "query": query, "maxResults": 6,
            "filters": {"countryCodesIso2": ["US"], "types": ["address", "area", "poi", "street"]},
        })
        return parse_places(payload, facilities=False)

    def facilities(self, lon: float, lat: float, *, fuel_only: bool = False, radius: int = 25_000) -> list[Location]:
        kinds = ["fuel_station"] if fuel_only else sorted(_FACILITY_TYPES)
        payload = self._request("POST", "/maps/orbis/places/discover", body={
            "maxResults": 10,
            "origin": {"type": "point", "coordinates": [lon, lat]},
            "preferences": {"geometry": {"type": "point", "coordinates": [lon, lat]}},
            "filters": {
                "countryCodesIso2": ["US"], "types": ["poi"], "poiTypes": kinds,
                "geometry": {"type": "circle", "center": [lon, lat], "radiusInMeters": radius},
            },
        })
        return parse_places(payload, facilities=True)

    def route(self, origin: Location, destination: Location) -> Route:
        if (origin.lat, origin.lon) == (destination.lat, destination.lon):
            return Route(origin, destination, 0, 0, [(origin.lon, origin.lat)])
        path = f"/routing/1/calculateRoute/{origin.lat},{origin.lon}:{destination.lat},{destination.lon}/json"
        payload = self._request("GET", path, params=[
            ("travelMode", "truck"), ("traffic", "false"), ("routeType", "fastest"),
            ("instructionsType", "text"), ("language", "en-US"),
            ("avoid", "borderCrossings"), ("avoid", "ferries"), ("avoid", "carTrains"),
            ("sectionType", "country"), ("sectionType", "travelMode"), ("sectionType", "ferry"),
            ("extendedRouteRepresentation", "distance"), ("extendedRouteRepresentation", "travelTime"),
        ])
        return parse_route(payload, origin, destination)
