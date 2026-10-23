import { mergeMembershipProfile, type MembershipProfile } from './membership-profile';

function profile(overrides: Partial<MembershipProfile> = {}): MembershipProfile {
  return {
    id: 'profile-id',
    createdAt: '2026-01-01T00:00:00.000Z',
    mobileNumber: '07111111111',
    email: 'member@example.com',
    membershipType: 'family',
    membershipNumber: '203',
    membershipHolderName: 'Directory Member',
    memberAge: 40,
    spouseName: 'Old Spouse',
    spouseAge: 38,
    children: [{ name: 'Old Child', age: 10 }],
    otherFamilyMembers: 'Old family member',
    address: 'Old address',
    postcode: 'SO53 2PL',
    phone: '07222222222',
    spousePhone: '07333333333',
    additionalPhones: 'Old additional phone',
    consent: true,
    ...overrides,
  };
}

describe('mergeMembershipProfile', () => {
  it('updates supplied details while keeping the verified membership identity', () => {
    const current = profile();
    const incoming = profile({
      id: 'renewal-id',
      createdAt: '2026-02-01T00:00:00.000Z',
      mobileNumber: '07444444444',
      email: 'new@example.com',
      membershipType: 'individual',
      membershipNumber: '999',
      membershipHolderName: 'Unverified Name',
      memberAge: 41,
      spouseName: 'New Spouse',
      spouseAge: 39,
      children: [{ name: 'New Child', age: 11 }],
      otherFamilyMembers: 'New family member',
      address: 'New address',
      postcode: 'SO50 9AA',
      phone: '07555555555',
      spousePhone: '07666666666',
      additionalPhones: 'New additional phone',
    });

    const merged = mergeMembershipProfile(current, incoming);

    expect(merged.membershipNumber).toBe('203');
    expect(merged.membershipHolderName).toBe('Directory Member');
    expect(merged.createdAt).toBe('2026-02-01T00:00:00.000Z');
    expect(merged.address).toBe('New address');
    expect(merged.email).toBe('new@example.com');
    expect(merged.phone).toBe('07555555555');
    expect(merged.spouseName).toBe('New Spouse');
    expect(merged.children).toEqual([{ name: 'New Child', age: 11 }]);
    expect(merged.membershipType).toBe('individual');
    expect(merged.memberAge).toBe(41);
  });

  it('preserves existing values when optional renewal fields are blank', () => {
    const current = profile();
    const incoming = profile({
      email: '',
      spouseName: '',
      spouseAge: null,
      children: [{ name: '', age: null }],
      otherFamilyMembers: '',
      address: '',
      postcode: '',
      spousePhone: '',
      additionalPhones: '',
    });

    const merged = mergeMembershipProfile(current, incoming);

    expect(merged.email).toBe(current.email);
    expect(merged.spouseName).toBe(current.spouseName);
    expect(merged.spouseAge).toBe(current.spouseAge);
    expect(merged.children).toEqual(current.children);
    expect(merged.address).toBe(current.address);
    expect(merged.postcode).toBe(current.postcode);
    expect(merged.additionalPhones).toBe(current.additionalPhones);
  });
});
