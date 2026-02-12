from pydantic import BaseModel, Field
from typing import List


class ComponentResult(BaseModel):
    """Schema for a single detected UI component's audit result."""

    cls: str = Field(..., alias="class", description="Detected component class name")
    confidence: float = Field(..., description="YOLO detection confidence")
    bbox: List[int] = Field(..., description="Bounding box [x1, y1, x2, y2]")
    similarity_score: float = Field(
        ..., description="Similarity score (%) against expert library"
    )
    matched_expert: str = Field(
        ..., description="Filename of the closest expert match"
    )


class AuditResponse(BaseModel):
    """Schema for the full audit report response."""

    report_id: str
    overall_score: float
    grade: str
    total_components: int
    components: List[ComponentResult]
    report_image_url: str
