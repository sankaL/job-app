from __future__ import annotations


class QuotaExceededError(PermissionError):
    code = "quota_exhausted"


class QuotaReservationBusyError(PermissionError):
    code = "quota_busy"
