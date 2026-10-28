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

  it('uses renewed family names and keeps them under the same membership number', () => {
    expect(
      getMembershipNames('239', ['Abymon Jacob'], 'Updated Spouse', [
        'Child One',
        'Child Two',
      ]),
    ).toEqual(['Abymon Jacob', 'Updated Spouse', 'Child One', 'Child Two']);
  });

  it('uses the renewed spouse phone when it has been updated', () => {
    expect(getMembershipPhoneNumbers('239', '07577738234', '07123456789')).toEqual([
      '07577738234',
      '07123456789',
    ]);
  });
});
