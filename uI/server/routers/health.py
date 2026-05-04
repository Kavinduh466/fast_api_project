from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health", summary="Health check")
async def health_check():
    """Return server health status."""
    return {"status": "ok"}
