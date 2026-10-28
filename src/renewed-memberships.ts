export const renewedMembershipNumbers: ReadonlySet<string> = new Set([
  '323', '452', '275', '57', '76', '105', '147', '295', '162', '331',
  '62', '327', '290', '10', '203', '20', '341', '67', '231', '100',
  '128', '30', '332', '54', '309', '192', '170', '316', '317', '330',
  '8', '370', '11', '116', '287', '256', '70', '246', '240', '250',
  '106', '425', '289', '296', '160', '202', '161', '29', '90', '40',
  '383', '439', '194', '206', '164', '101', '505', '506', '507', '305',
  '195', '145', '245', '208', '324', '36', '85', '75', '22', '87',
  '228', '451', '416', '201', '436', '386', '334', '117', '200', '72',
  '304', '165', '355', '227', '384', '320', '346', '236', '367', '125',
  '368', '449', '392', '239', '298', '319', '403', '421', '15', '294',
  '51', '259', '333', '142', '264', '325', '418', '113', '504', '283',
  '303', '431', '226', '88', '23', '302', '238', '104', '24', '173',
  '399', '381', '344', '50', '137', '58', '322', '448', '191', '96',
  '28', '205', '369', '174', '189', '132', '121', '60', '230', '42',
  '34', '77', '405', '103', '447', '198', '184', '37', '501', '285',
  '115', '148', '155', '112', '232', '385', '374', '83',
  '53', '242', '66', '244', '263', '9', '146', '92', '171', '159',
  '91', '257', '141', '235', '380', '318', '38', '279', '12', '133',
  '265', '328', '345', '134', '433', '268', '122', '5', '282', '430',
  '299', '453', '49', '500', '508', '509', '510', '511',
]);

export type RenewalMembershipType = 'individual' | 'family';

export const renewedMembershipTypes: Readonly<Record<string, RenewalMembershipType>> = {
  '439': 'family',
  '440': 'family',
  '441': 'family',
  '442': 'family',
  '444': 'family',
  '445': 'family',
  '446': 'family',
  '447': 'family',
  '451': 'family',
  '452': 'family',
  '453': 'family',
  '508': 'family',
  '509': 'individual',
  '510': 'family',
  '511': 'family',
};

export function getRenewedMembershipType(
  membershipNumber: string,
): RenewalMembershipType {
  const normalizedMembershipNumber = membershipNumber.trim().replace(/^0+(?=\d)/, '');
  return renewedMembershipTypes[normalizedMembershipNumber] ?? 'individual';
}

export function isMembershipRenewed(membershipNumber: string): boolean {
  const normalizedMembershipNumber = membershipNumber.trim().replace(/^0+(?=\d)/, '');
  return renewedMembershipNumbers.has(normalizedMembershipNumber);
}
