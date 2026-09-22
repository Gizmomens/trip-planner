class PlanningError(Exception):
    def __init__(self, code: str, message: str, status: int = 422, fields: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.fields = fields or {}
