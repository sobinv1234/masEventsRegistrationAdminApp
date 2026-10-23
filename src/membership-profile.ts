export type MembershipProfile = {
  id: string;
  createdAt: string;
  mobileNumber?: string;
  email: string;
  membershipType: 'individual' | 'family';
  membershipNumber: string;
  membershipHolderName: string;
  memberAge: number;
  spouseName: string;
  spouseAge: number | null;
  children: { name: string; age: number | null }[];
  otherFamilyMembers: string;
  address: string;
  postcode: string;
  phone: string;
  spousePhone: string;
  additionalPhones: string;
  consent: true;
};

export function mergeMembershipProfile(
  current: MembershipProfile,
  incoming: MembershipProfile,
): MembershipProfile {
  const mergeText = (existing: string, submitted: string): string =>
    submitted.trim() ? submitted : existing;

  return {
    ...current,
    createdAt: incoming.createdAt,
    mobileNumber: incoming.mobileNumber || current.mobileNumber,
    email: mergeText(current.email, incoming.email),
    membershipType: incoming.membershipType,
    memberAge: incoming.memberAge,
    spouseName: mergeText(current.spouseName, incoming.spouseName),
    spouseAge: incoming.spouseAge ?? current.spouseAge,
    children: current.children.map((existing, index) => {
      const submitted = incoming.children[index];
      return submitted
        ? {
            name: mergeText(existing.name, submitted.name),
            age: submitted.age ?? existing.age,
          }
        : existing;
    }),
    otherFamilyMembers: mergeText(
      current.otherFamilyMembers,
      incoming.otherFamilyMembers,
    ),
    address: mergeText(current.address, incoming.address),
    postcode: mergeText(current.postcode, incoming.postcode),
    phone: mergeText(current.phone, incoming.phone),
    spousePhone: mergeText(current.spousePhone, incoming.spousePhone),
    additionalPhones: mergeText(
      current.additionalPhones,
      incoming.additionalPhones,
    ),
  };
}
