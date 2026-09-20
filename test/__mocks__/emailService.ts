/**
 * Mock EmailService — records calls so tests can assert which emails fired.
 */

type EmailCall = {
  to: string;
  fullName: string;
  days?: number;
  referrerFullName?: string;
  referralId?: string;
  expiresAt?: Date;
};

class MockEmailService {
  public calls: EmailCall[] = [];

  sendReferralRewardEmail = jest.fn(
    async (to: string, fullName: string, days: number): Promise<boolean> => {
      this.calls.push({ to, fullName, days });
      return true;
    }
  );

  sendRefereeRewardEmail = jest.fn(
    async (
      to: string,
      fullName: string,
      referrerFullName: string,
      days: number,
    ): Promise<boolean> => {
      this.calls.push({ to, fullName, days, referrerFullName });
      return true;
    }
  );

  sendReferralExpirationReminder = jest.fn(
    async (
      to: string,
      fullName: string,
      referralId: string,
      expiresAt: Date,
    ): Promise<boolean> => {
      this.calls.push({ to, fullName, referralId, expiresAt });
      return true;
    }
  );

  reset() {
    this.calls = [];
    this.sendReferralRewardEmail.mockClear();
    this.sendRefereeRewardEmail.mockClear();
    this.sendReferralExpirationReminder.mockClear();
  }
}

// Export a singleton instance
export const EmailServiceMock = new MockEmailService();
