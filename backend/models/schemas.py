"""
backend/models/schemas.py
Data structure representations and validation helpers.
"""

from typing import TypedDict, Optional, List, Dict, Any

class ResidentDict(TypedDict, total=False):
    id: int
    name: str
    property_id: str
    ward: str
    phone: str
    address: str
    base_amount: float
    payment_status: str
    paid_date: Optional[str]
    created_at: str

class TaxCycleDict(TypedDict, total=False):
    id: int
    fy_label: str
    collection_from_month: int
    collection_to_month: int
    due_date: str
    rebate_enabled: int
    rebate_percent: float
    rebate_deadline: str
    penalty_type: str
    penalty_value: float
    penalty_start_days: int
    is_active: int
    created_at: str
    pre_reminders: List[int]
    post_reminders: List[int]

class CadenceDict(TypedDict):
    id: int
    cycle_id: int
    stage_type: str
    days_offset: int

class TemplateDict(TypedDict):
    id: int
    template_type: str
    language: str
    body: str

class ReminderLogDict(TypedDict, total=False):
    id: int
    resident_id: int
    cycle_id: int
    stage_type: str
    days_offset: int
    channel: str
    status: str
    error_message: str
    sent_at: str
    name: Optional[str]
    phone: Optional[str]
    property_id: Optional[str]
