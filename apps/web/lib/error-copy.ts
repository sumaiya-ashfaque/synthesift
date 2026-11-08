/** Safe, user-facing request failures. Never echo provider bodies or credentials. */

type FailureContext = 'request' | 'upload';

export function apiErrorMessage(
  status: number,
  requestId: string | null,
  context: FailureContext = 'request',
): string {
  const base = status === 503 || status === 502 || status === 504
    ? `Service temporarily unavailable (${status}). Retry shortly.`
    : status === 422
      ? 'The submitted data could not be processed. Review it and try again.'
      : context === 'upload'
        ? `Upload rejected (${status}). Verify the CSV file and retry.`
        : `Request failed (${status}). Check the input and try again.`;

  // Only attach a server-generated UUID, never arbitrary reflected header text.
  const validId = requestId?.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return validId ? `${base} Support reference: ${requestId}.` : base;
}
