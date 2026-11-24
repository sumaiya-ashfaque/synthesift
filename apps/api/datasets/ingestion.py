"""Strict, bounded inspection of immutable multi-format dataset originals."""

from .formats import AdmissionError, CSVSummary, inspect_tabular


def inspect_csv(dataset) -> CSVSummary:
    """Verify source integrity and tabular structure without exposing raw rows."""
    return inspect_tabular(dataset)


inspect_dataset = inspect_csv

__all__ = ["AdmissionError", "CSVSummary", "inspect_csv", "inspect_dataset"]
