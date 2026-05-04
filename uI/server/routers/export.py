from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from typing import Any, Dict
from server.services.report_service import generate_markdown_report

router = APIRouter(prefix="/audit/export", tags=["export"])

@router.post("", summary="Generate and download a Markdown report")
async def export_report(audit_result: Dict[str, Any]):
    """
    Receives audit results and returns a downloadable Markdown file.
    """
    try:
        print(f"\n--- [API POST /audit/export] ---")
        print(f"Export requested for report at {audit_result.get('meta', {}).get('timestamp')}")
        
        report_md = generate_markdown_report(audit_result)
        print(f"Export: Generated Markdown report ({len(report_md)} bytes)")
        return Response(
            content=report_md,
            media_type="text/markdown",
            headers={
                "Content-Disposition": f"attachment; filename=ui_audit_report.md"
            }
        )
    except Exception as e:
        print(f"Export Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
