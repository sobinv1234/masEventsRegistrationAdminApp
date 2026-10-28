import {
  getRenewedMembershipType,
  isMembershipRenewed,
} from './renewed-memberships';

describe('renewed memberships', () => {
  it('returns the configured renewal type for supplied existing members', () => {
    expect(getRenewedMembershipType('00439')).toBe('family');
    expect(getRenewedMembershipType('509')).toBe('individual');
  });

  it('includes the newly assigned membership numbers in the renewed list', () => {
    for (const membershipNumber of ['508', '509', '510', '511']) {
      expect(isMembershipRenewed(membershipNumber)).toBeTrue();
    }
  });
});
