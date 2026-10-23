import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Registration } from './registration';

describe('Registration', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Registration],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
  });

  it('shows the guardian field for minors and Cards only for adults', async () => {
    const fixture = TestBed.createComponent(Registration);
    fixture.detectChanges();
    await fixture.whenStable();
    const ageInput = fixture.nativeElement.querySelector(
      'input[name="age"]',
    ) as HTMLInputElement;

    ageInput.value = '17';
    ageInput.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Parent / guardian name');
    expect(fixture.nativeElement.textContent).not.toContain('🃏 Cards');

    ageInput.value = '18';
    ageInput.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Parent / guardian name');
    expect(fixture.nativeElement.textContent).toContain('🃏 Cards');
  });

  it('assigns the requested age categories to the other games', async () => {
    const fixture = TestBed.createComponent(Registration);
    fixture.detectChanges();
    await fixture.whenStable();
    const ageInput = fixture.nativeElement.querySelector(
      'input[name="age"]',
    ) as HTMLInputElement;

    for (const [age, category] of [
      ['8', '8–13'],
      ['14', '14–17'],
      ['18', '18+'],
    ]) {
      ageInput.value = age;
      ageInput.dispatchEvent(new Event('input', { bubbles: true }));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.category')?.textContent).toContain(
        category,
      );
    }
  });

  it('shows one £5 fee per participant and requires payment confirmation', async () => {
    const fixture = TestBed.createComponent(Registration);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.payment-section')?.textContent).toContain(
      '£5 per participant',
    );
    expect(fixture.nativeElement.querySelector('.payment-section')?.textContent).toContain(
      'one fee covers all games',
    );
    expect(
      fixture.nativeElement.querySelector('input[name="paymentConfirmed"]')?.required,
    ).toBeTrue();
  });

  it('requires a membership number and identifies it as the payment reference', async () => {
    const fixture = TestBed.createComponent(Registration);
    fixture.detectChanges();
    await fixture.whenStable();

    const membershipNumber = fixture.nativeElement.querySelector(
      'input[name="membershipNumber"]',
    ) as HTMLInputElement;
    expect(membershipNumber.required).toBeTrue();
    expect(fixture.nativeElement.querySelector('.payment-details')?.textContent).toContain(
      'Membership number',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Use your membership number as the bank transfer reference.',
    );
  });

  it('submits the membership number without losing leading zeroes', async () => {
    const fixture = TestBed.createComponent(Registration);
    const registration = fixture.componentInstance;
    registration['name'] = 'Abhilash Padayattil';
    registration['membershipNumber'] = '00245';
    registration['age'] = 18;
    registration['phone'] = '07123456789';
    registration['selectedGames'] = ['Chess'];
    registration['consent'] = true;
    registration['paymentConfirmed'] = true;
    const fetchSpy = spyOn(globalThis, 'fetch').and.callFake(
      async (input: RequestInfo | URL) => {
        if (String(input) === '/api/membership-lookup') {
          return new Response(JSON.stringify({ names: ['Abhilash Padayattil'] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ message: 'Registration submitted.' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    await registration['submit']();

    const submission = fetchSpy.calls.all().find(
      (call) => String(call.args[0]) === '/api/registrations',
    );
    expect(JSON.parse(submission?.args[1]?.body as string)).toEqual(
      jasmine.objectContaining({
        membershipNumber: '00245',
        name: 'Abhilash Padayattil',
      }),
    );
  });

  it('autofills a single matching member name', async () => {
    const fixture = TestBed.createComponent(Registration);
    const registration = fixture.componentInstance;
    fixture.detectChanges();
    registration['membershipNumber'] = '245';
    spyOn(globalThis, 'fetch').and.resolveTo(
      new Response(JSON.stringify({ names: ['Abhilash Padayattil'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await registration['lookupMembershipNumber']();

    expect(registration['name']).toBe('Abhilash Padayattil');
    expect(registration['membershipNames']).toEqual(['Abhilash Padayattil']);
  });

  it('shows a dropdown for multiple matching member names and uses the selected name', async () => {
    const fixture = TestBed.createComponent(Registration);
    const registration = fixture.componentInstance;
    fixture.detectChanges();
    registration['membershipNumber'] = 'duplicate-test';
    spyOn(globalThis, 'fetch').and.resolveTo(
      new Response(JSON.stringify({
        names: ['Shared Member One', 'Shared Member Two'],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await registration['lookupMembershipNumber']();
    await fixture.whenStable();
    fixture.detectChanges();

    const nameSelect = fixture.nativeElement.querySelector(
      'select[name="name"]',
    ) as HTMLSelectElement;
    expect(nameSelect).not.toBeNull();
    expect(nameSelect.options.length).toBe(3);
    expect(registration['name']).toBe('');

    nameSelect.selectedIndex = 2;
    nameSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(registration['name']).toBe('Shared Member Two');
    expect(registration['membershipNumberValid']).toBeTrue();
    expect(registration['membershipLookupMessage']).toContain('selected');
  });

  it('keeps the name field as text for a single member match', async () => {
    const fixture = TestBed.createComponent(Registration);
    const registration = fixture.componentInstance;
    fixture.detectChanges();
    registration['membershipNumber'] = '245';
    spyOn(globalThis, 'fetch').and.resolveTo(
      new Response(JSON.stringify({ names: ['Abhilash Padayattil'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await registration['lookupMembershipNumber']();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('select[name="name"]')).toBeNull();
    expect(
      (fixture.nativeElement.querySelector('input[name="name"]') as HTMLInputElement)
        .value,
    ).toBe('Abhilash Padayattil');
    expect(registration['membershipLookupMessage']).toContain('You can edit');
  });

  it('keeps submit disabled unless the membership number is on the list', async () => {
    const fixture = TestBed.createComponent(Registration);
    const registration = fixture.componentInstance;
    registration['name'] = 'Unknown Member';
    registration['age'] = 18;
    registration['phone'] = '07123456789';
    registration['selectedGames'] = ['Chess'];
    registration['consent'] = true;
    registration['paymentConfirmed'] = true;
    fixture.detectChanges();

    const submitButton = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submitButton.disabled).toBeTrue();

    registration['membershipNumber'] = '999';
    registration['onMembershipNumberChange']();
    spyOn(globalThis, 'fetch').and.resolveTo(
      new Response(JSON.stringify({ message: 'No member found for that number.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await registration['lookupMembershipNumber']();
    fixture.detectChanges();

    expect(submitButton.disabled).toBeTrue();
    expect(registration['membershipNumberValid']).toBeFalse();
  });

  it('fills the member number and name when the mobile number matches', async () => {
    const fixture = TestBed.createComponent(Registration);
    const registration = fixture.componentInstance;
    fixture.detectChanges();
    registration['phone'] = '+44 7737 368789';
    const fetchSpy = spyOn(globalThis, 'fetch').and.callFake(
      async (input: RequestInfo | URL) => {
        if (String(input) === '/api/membership-phone-lookup') {
          return new Response(
            JSON.stringify({
              matches: [{ membershipNumber: '20', names: ['Biju Abraham'] }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ names: ['Biju Abraham'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    await registration['lookupMembershipByPhone']();

    expect(fetchSpy.calls.allArgs().map(([url]) => String(url))).toEqual([
      '/api/membership-phone-lookup',
      '/api/membership-lookup',
    ]);
    expect(registration['membershipNumber']).toBe('20');
    expect(registration['name']).toBe('Biju Abraham');
    expect(registration['membershipNumberValid']).toBeTrue();
  });

  it('normalizes UK mobile numbers with 0, +44, or no country prefix equally', () => {
    const fixture = TestBed.createComponent(Registration);
    const registration = fixture.componentInstance;
    const normalize = registration['normalizePhoneNumber'].bind(registration);

    expect(normalize('0741111775410')).toBe('0741111775410');
    expect(normalize('+44741111775410')).toBe('0741111775410');
    expect(normalize('741111775410')).toBe('0741111775410');
  });

  it('asks the user to choose when a mobile number matches multiple members', async () => {
    const fixture = TestBed.createComponent(Registration);
    const registration = fixture.componentInstance;
    fixture.detectChanges();
    registration['phone'] = '07123456789';
    spyOn(globalThis, 'fetch').and.resolveTo(
      new Response(
        JSON.stringify({
          matches: [
            { membershipNumber: '20', names: ['Member One'] },
            { membershipNumber: '21', names: ['Member Two'] },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await registration['lookupMembershipByPhone']();
    fixture.detectChanges();

    const memberSelect = fixture.nativeElement.querySelector(
      'select[name="phoneMember"]',
    ) as HTMLSelectElement;
    expect(memberSelect).not.toBeNull();
    expect(registration['membershipNumber']).toBe('');
    expect(registration['phoneLookupMessage']).toContain('Choose a member');
  });

  it('displays the event time and email-only notification consent', async () => {
    const fixture = TestBed.createComponent(Registration);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('12:00 PM–5:00 PM UK time');
    expect(fixture.nativeElement.textContent).toContain(
      'registration confirmation by email if provided',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'No SMS messages are sent',
    );
  });
});
