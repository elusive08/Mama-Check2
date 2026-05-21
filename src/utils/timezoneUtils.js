import moment from "moment-timezone";

// West Africa Time (UTC+1)
const WAT_TIMEZONE = "Africa/Lagos";

/**
 * Get current time in WAT
 * @returns {moment.Moment} - Current WAT time
 */
export const getCurrentWATTime = () => {
  return moment().tz(WAT_TIMEZONE);
};

/**
 * Convert date to WAT
 * @param {Date|string} date - Date to convert
 * @returns {moment.Moment} - WAT time
 */
export const toWAT = (date) => {
  return moment(date).tz(WAT_TIMEZONE);
};

/**
 * Get WAT time at specific hour
 * @param {number} hour - Hour (0-23)
 * @param {number} minute - Minute (0-59)
 * @returns {moment.Moment} - WAT time at hour:minute
 */
export const getWATAtTime = (hour, minute = 0) => {
  return moment().tz(WAT_TIMEZONE).hour(hour).minute(minute).second(0);
};

/**
 * Convert cron expression to WAT
 * Used for scheduling jobs at specific WAT times
 * @param {number} hour - Hour in WAT (0-23)
 * @param {number} minute - Minute (0-59)
 * @returns {string} - Cron expression
 */
export const cronExpressionForWAT = (hour, minute = 0) => {
  // Note: server must handle timezone offset
  // For WAT (UTC+1), if job should run at 07:00 WAT:
  // Calculate the UTC equivalent
  const utcHour = (hour - 1 + 24) % 24;
  return `${minute} ${utcHour} * * *`;
};

/**
 * Get time until next reminder (WAT timezone aware)
 * @param {moment.Moment} targetTime - Target time in WAT
 * @returns {number} - Milliseconds until target time
 */
export const getMillisecondsUntilWATTime = (targetTime) => {
  const now = getCurrentWATTime();
  const diff = targetTime.diff(now);
  return diff > 0 ? diff : diff + 24 * 60 * 60 * 1000; // Add 24 hours if in past
};
