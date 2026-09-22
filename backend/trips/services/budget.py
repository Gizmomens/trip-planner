import time

from trips.domain.assumptions import Limits
from trips.domain.errors import PlanningError


class Budget:
    def __init__(self, limits: Limits, clock=time.monotonic):
        self.limits = limits
        self.clock = clock
        self.deadline = clock() + limits.processing_seconds
        self.requests = 0

    def check(self) -> float:
        remaining = self.deadline - self.clock()
        if remaining <= 0:
            raise self.timeout_error()
        return remaining

    @staticmethod
    def timeout_error() -> PlanningError:
        return PlanningError("deadline_exceeded", "Planning took too long. Try a shorter trip.", 504)

    def request(self) -> float:
        remaining = self.check()
        if self.requests >= self.limits.provider_requests:
            raise PlanningError("request_limit", "The provider-request limit was reached. Try a shorter trip.")
        self.requests += 1
        return remaining
