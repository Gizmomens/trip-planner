from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Literal

Status = Literal["off_duty", "sleeper", "driving", "on_duty"]


@dataclass(frozen=True)
class Location:
    id: str
    name: str
    address: str
    lat: float
    lon: float
    kind: str = "location"

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class RoutePoint:
    lon: float
    lat: float
    seconds: float
    meters: float


@dataclass
class Route:
    origin: Location
    destination: Location
    meters: float
    seconds: int
    geometry: list[tuple[float, float]]
    instructions: list[dict] = field(default_factory=list)
    progress: list[RoutePoint] = field(default_factory=list)


@dataclass(frozen=True)
class Activity:
    id: str
    status: Status
    purpose: str
    start_at: datetime
    end_at: datetime
    start_location: Location
    end_location: Location
    distance_meters: float = 0
    progress: tuple[RoutePoint, ...] = ()

    @property
    def seconds(self) -> int:
        return int((self.end_at - self.start_at).total_seconds())

    def to_dict(self) -> dict:
        result = asdict(self)
        result.pop("progress")
        result["start_at"] = self.start_at.isoformat()
        result["end_at"] = self.end_at.isoformat()
        return result
