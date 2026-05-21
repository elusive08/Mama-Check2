/**
 * Slack Monitoring Service
 * Sends alerts to Slack for critical events
 */

/**
 * Send Slack notification
 * @param {string} message - Message to send
 * @param {string} severity - 'info', 'warning', 'error', 'critical'
 * @param {Object} metadata - Additional data to include
 */
export const sendSlackNotification = async (
  message,
  severity = "info",
  metadata = {},
) => {
  if (!process.env.SLACK_WEBHOOK_URL) {
    console.warn(
      "SLACK_WEBHOOK_URL not configured. Notification not sent:",
      message,
    );
    return;
  }

  const severityColors = {
    info: "#36a64f",
    warning: "#ff9500",
    error: "#ff0000",
    critical: "#8b0000",
  };

  const payload = {
    attachments: [
      {
        color: severityColors[severity] || "#36a64f",
        title: `🚨 ${severity.toUpperCase()}: MamaCheck Alert`,
        text: message,
        fields: [
          {
            title: "Timestamp",
            value: new Date().toISOString(),
            short: true,
          },
          {
            title: "Environment",
            value: process.env.NODE_ENV || "unknown",
            short: true,
          },
          ...(Object.keys(metadata).length > 0
            ? [
                {
                  title: "Details",
                  value: JSON.stringify(metadata, null, 2),
                  short: false,
                },
              ]
            : []),
        ],
        footer: "MamaCheck System",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  try {
    const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.statusText}`);
    }

    console.log(`[SLACK] ${severity.toUpperCase()}: ${message}`);
  } catch (error) {
    console.error("Error sending Slack notification:", error);
  }
};

/**
 * Alert for cron job failure
 */
export const alertCronJobFailure = (jobName, error) => {
  sendSlackNotification(
    `Cron job failed: ${jobName}`,
    "critical",
    {
      job: jobName,
      error: error.message,
      stack: error.stack,
    },
  );
};

/**
 * Alert for RED flag delivery failure
 */
export const alertRedFlagDeliveryFailure = (womanPhone, symptoms, retryCount) => {
  sendSlackNotification(
    `RED flag SMS delivery failed for woman: ${womanPhone}`,
    "critical",
    {
      womanPhone,
      symptoms,
      retryCount,
      message: "Retry limit exceeded. Manual intervention needed.",
    },
  );
};

/**
 * Alert for low Termii wallet balance
 */
export const alertLowWalletBalance = (balance, threshold) => {
  sendSlackNotification(
    `Low Termii wallet balance: ₦${balance}`,
    "warning",
    {
      currentBalance: balance,
      threshold,
      message:
        "Consider topping up to avoid service interruption.",
    },
  );
};

/**
 * Alert for database connection failure
 */
export const alertDatabaseFailure = (error) => {
  sendSlackNotification(
    "Database connection failed",
    "critical",
    {
      error: error.message,
      message: "Application may be experiencing downtime.",
    },
  );
};

/**
 * Alert for Termii API failure
 */
export const alertTermiiAPIFailure = (error, context) => {
  sendSlackNotification(
    "Termii API error",
    "error",
    {
      error: error.message,
      context,
    },
  );
};
