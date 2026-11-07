"""Portable PDF audit of a completed, explicitly approved transformation."""

from html import escape
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def render_audit_pdf(run) -> bytes:
    buf = BytesIO()
    document = SimpleDocTemplate(
        buf, pagesize=(612, 792), leftMargin=54, rightMargin=54,
        topMargin=48, bottomMargin=48,
        title="SyntheSift Remediation Audit",
    )
    styles = getSampleStyleSheet()
    elements = [
        Paragraph("SyntheSift | Remediation audit", styles["Title"]),
        Paragraph("Immutable source to reviewed derived dataset", styles["Normal"]),
        Spacer(1, 0.22 * inch),
    ]

    def line(label, value):
        elements.append(Paragraph(
            f"<b>{escape(label)}</b> {escape(str(value))}", styles["Normal"]
        ))
        elements.append(Spacer(1, 0.09 * inch))

    line("Audit ID:", run.id)
    line("Source dataset:", run.dataset_id)
    line("Derived dataset:", run.result_dataset_id)
    line("AI report reference:", run.report_id)
    line("Approved by user ID:", run.requested_by_id)
    line("Approved at (UTC):", run.applied_at)
    line("Operations:", ", ".join(run.operations))
    line("Original SHA-256:", run.dataset.sha256)
    line("Derived SHA-256:", run.result_dataset.sha256)
    elements.append(Spacer(1, 0.16 * inch))

    before = run.preview["before"]
    after = run.preview["after"]
    values = [
        ["Metric", "Before", "After"],
        ["Rows", str(before["rows"]), str(after["rows"])],
        ["Missing cells", str(before["missing_cells"]), str(after["missing_cells"])],
        ["Exact duplicate rows", str(before["exact_duplicates"]), str(after["exact_duplicates"])],
    ]
    table = Table(values, colWidths=[245, 120, 120])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8F1EC")),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D1DED6")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    elements.extend([table, Spacer(1, 0.2 * inch)])
    line("Derived profile:", run.validation.get("derived_profile_status", "unknown"))
    line("Completeness after:", f"{run.validation.get('after_completeness_percent', 'not measured')}%")
    elements.append(Paragraph(
        "Validation scope: deterministic CSV structure and aggregate counts. "
        "No claim of semantic correctness is made; owner approval was required. "
        "The original source remains unchanged.", styles["Normal"]
    ))
    document.build(elements)
    return buf.getvalue()
