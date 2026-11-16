/**
 * Why a job's log is not in hand.
 *
 * A separate module because three files need it and none of them should import
 * another for a constant: the adapter produces these reasons, the classifier carries
 * them through, and the renderer turns them into prose. `LOG_UNAVAILABLE` is the
 * output label; these are the reasons behind it.
 *
 * The list exists so "the log was empty" and "I could not ask" cannot be reported as
 * the same thing. The previous version returned `''` for every failure and the report
 * printed an empty cell, which read as "there was nothing to see".
 */
export const LOG_UNAVAILABLE_REASONS = {
  MISSING_JOB_ID: 'the job list carried no id, so no log could be requested',
  MALFORMED_JOB_ID: 'the job id was not a positive integer',
  FORBIDDEN: 'the API refused the log request (403); the token lacks actions:read',
  NOT_FOUND: 'the job has no log yet, or the id does not exist (404)',
  EXPIRED: 'the log has been deleted by retention (410)',
  EMPTY: 'the log was empty',
  RATE_LIMITED: 'the API rate-limited the request (429)',
  DOWNLOAD_FAILED: 'the log download failed (network, timeout, or a non-redirect error)',
  TOO_LARGE: 'the log exceeded the size limit',
  MALFORMED_RESPONSE: 'the API response could not be parsed as JSON',
  PAGE_LIMIT_REACHED: 'the job list page cap was reached before the list was complete',
}
