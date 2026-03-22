import * as authEmails from "./email/authEmails";
import * as notificationEmails from "./email/notificationEmails";
import * as billingEmails from "./email/billingEmails";

/**
 * @deprecated Use domain-specific mailers from ./email/ instead.
 * This class acts as a compatibility layer for existing code.
 */
export class EmailService {
  /**
   * Authentication Emails
   */
  static sendOTPEmail = authEmails.sendOTPEmail;
  static sendWelcomeEmail = authEmails.sendWelcomeEmail;
  static sendPasswordResetEmail = authEmails.sendPasswordResetEmail;
  static send2FAEnabledEmail = authEmails.send2FAEnabledEmail;
  static sendProfileUpdateOTPEmail = authEmails.sendProfileUpdateOTPEmail;
  static sendAccountDeletionEmail = authEmails.sendAccountDeletionEmail;

  /**
   * Notification Emails
   */
  static sendNotificationEmail = notificationEmails.sendNotificationEmail;
  static sendWorkspaceInvitation = notificationEmails.sendWorkspaceInvitation;
  static sendWorkspaceRemovalEmail = notificationEmails.sendWorkspaceRemovalEmail;
  static sendScanCompletionEmail = notificationEmails.sendScanCompletionEmail;
  static sendCertificateReadyEmail = notificationEmails.sendCertificateReadyEmail;
  static sendCollaborationNotificationEmail = notificationEmails.sendCollaborationNotificationEmail;
  static sendUsageLimitWarningEmail = notificationEmails.sendUsageLimitWarningEmail;
  static sendUsageLimitReachedEmail = notificationEmails.sendUsageLimitReachedEmail;
  static sendSearchAlertEmail = notificationEmails.sendSearchAlertEmail;
  static sendProjectShareEmail = notificationEmails.sendProjectShareEmail;
  static sendAnalyticsNotificationEmail = notificationEmails.sendAnalyticsNotificationEmail;
  static sendAnalyticsReportEmail = notificationEmails.sendAnalyticsReportEmail;
  static sendInstitutionalPlanRequestEmail = notificationEmails.sendInstitutionalPlanRequestEmail;
  static sendCertificateExpirationWarningEmail = notificationEmails.sendCertificateExpirationWarningEmail;

  /**
   * Billing Emails
   */
  static sendSubscriptionConfirmationEmail = billingEmails.sendSubscriptionConfirmationEmail;
  static sendPaymentSuccessEmail = billingEmails.sendPaymentSuccessEmail;
  static sendPaymentFailedEmail = billingEmails.sendPaymentFailedEmail;
  static sendInvoiceAvailableEmail = billingEmails.sendInvoiceAvailableEmail;
  static sendPlanChangeEmail = billingEmails.sendPlanChangeEmail;
}
