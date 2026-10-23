import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MembershipRenewalForm } from './membership-renewal';

describe('MembershipRenewalForm', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MembershipRenewalForm],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
  });

  it('fills a single member match from the mobile number', async () => {
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(
          JSON.stringify({
            matches: [{ membershipNumber: '203', names: ['Shibu Merlin Thaliy'] }],
          }),
          { status: 200 },
        ),
      ),
    );
    const fixture = TestBed.createComponent(MembershipRenewalForm);
    const form = fixture.componentInstance;
    form['mobileNumber'] = '0741111775410';

    await form['lookupMember']();

    expect(form['membershipNumber']).toBe('203');
    expect(form['membershipHolderName']).toBe('Shibu Merlin Thaliy');
  });

  it('requires choosing a name when mobile lookup returns multiple matches', async () => {
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(
          JSON.stringify({
            matches: [{ membershipNumber: '051', names: ['Glice George', 'Jinoy Thottapillil'] }],
          }),
          { status: 200 },
        ),
      ),
    );
    const fixture = TestBed.createComponent(MembershipRenewalForm);
    const form = fixture.componentInstance;
    form['mobileNumber'] = '0741111775410';

    await form['lookupMember']();

    expect(form['membershipNumber']).toBe('');
    expect(form['memberOptions'].length).toBe(2);
    form['selectMember'](1);
    expect(form['membershipNumber']).toBe('051');
    expect(form['membershipHolderName']).toBe('Jinoy Thottapillil');
  });

  it('looks up the member name when a membership number is entered directly', async () => {
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(JSON.stringify({ names: ['Shibu Merlin Thaliy'] }), { status: 200 }),
      ),
    );
    const fixture = TestBed.createComponent(MembershipRenewalForm);
    const form = fixture.componentInstance;
    form['membershipNumber'] = '0203';

    await form['lookupMembershipNumber']();

    expect(window.fetch).toHaveBeenCalledWith(
      '/api/membership-lookup',
      jasmine.objectContaining({
        method: 'POST',
        body: JSON.stringify({ membershipNumber: '0203' }),
      }),
    );
    expect(form['membershipNumber']).toBe('0203');
    expect(form['membershipHolderName']).toBe('Shibu Merlin Thaliy');
  });
});
