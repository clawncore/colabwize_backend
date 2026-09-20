/**
 * Mock EntitlementService — records rebuild calls for assertions.
 */

export const entitlementRebuilds: string[] = [];

export const EntitlementServiceMock = {
  rebuildEntitlements: jest.fn(
    async (userId: string): Promise<void> => {
      entitlementRebuilds.push(userId);
    }
  ),

  reset() {
    entitlementRebuilds.length = 0;
    this.rebuildEntitlements.mockClear();
  },
};
