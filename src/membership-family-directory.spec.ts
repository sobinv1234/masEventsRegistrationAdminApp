import {
  getMembershipNames,
  getMembershipPhoneNumbers,
} from './membership-family-directory';

describe('membership family directory', () => {
  it('keeps both household names under the same membership number', () => {
    expect(getMembershipNames('239', ['Abymon Jacob'])).toEqual([
      'Abymon Jacob',
      'Jayamole Aby',
    ]);
  });

  it('matches either the member or spouse mobile to the same membership number', () => {
    expect(getMembershipPhoneNumbers('239', '07577738234')).toEqual([
      '07577738234',
      '07450903172',
    ]);
  });

  it('does not add a second name or phone when spouse details are not provided', () => {
    expect(getMembershipNames('265', ['Abey Naduvilla'])).toEqual([
      'Abey Naduvilla',
    ]);
    expect(getMembershipPhoneNumbers('265', '07910062051')).toEqual([
      '07910062051',
    ]);
  });
});
