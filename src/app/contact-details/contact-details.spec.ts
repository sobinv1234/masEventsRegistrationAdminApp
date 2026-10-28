import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ContactDetailsForm } from './contact-details';

describe('ContactDetailsForm', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContactDetailsForm],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
  });

  it('fills the membership number and available member details from a phone match', async () => {
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(
          JSON.stringify({
            matches: [{
              membershipNumber: '239',
              names: ['Abymon Jacob', 'Jayamole Aby'],
              membershipType: 'family',
            }],
          }),
          { status: 200 },
        ),
      ),
    );
    const form = TestBed.createComponent(ContactDetailsForm).componentInstance;
    form['phone'] = '07450903172';

    await form['lookupPhone']();
    form['selectMatch'](0);

    expect(form['membershipNumber']).toBe('239');
    expect(form['name']).toBe('Abymon Jacob, Jayamole Aby');
    expect(form['email']).toBe('');
  });

  it('keeps the directory-provided full name field disabled', async () => {
    const fixture = TestBed.createComponent(ContactDetailsForm);
    const form = fixture.componentInstance;
    form['phone'] = '07450903172';
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(
          JSON.stringify({
            matches: [{
              membershipNumber: '239',
              names: ['Abymon Jacob', 'Jayamole Aby'],
              membershipType: 'family',
            }],
          }),
          { status: 200 },
        ),
      ),
    );
    fixture.detectChanges();
    await form['lookupPhone']();
    fixture.detectChanges();
    const nameInput = fixture.nativeElement.querySelector(
      'input[name="name"]',
    ) as HTMLInputElement;

    expect(nameInput.disabled).toBeTrue();
    expect(nameInput.value).toBe('Abymon Jacob');
  });

  it('keeps names grouped by membership when a phone matches multiple memberships', async () => {
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(
          JSON.stringify({
            matches: [
              {
                membershipNumber: '239',
                names: ['Abymon Jacob', 'Jayamole Aby'],
                membershipType: 'family',
              },
              {
                membershipNumber: '240',
                names: ['Another Member', 'Family Member'],
                membershipType: 'family',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const fixture = TestBed.createComponent(ContactDetailsForm);
    const form = fixture.componentInstance;
    form['phone'] = '07450903172';

    await form['lookupPhone']();
    fixture.detectChanges();

    const options = Array.from(
      (fixture.nativeElement.querySelector('select[name="selectedMatch"]') as HTMLSelectElement)
        .options,
    ).map((option) => option.textContent?.trim());
    expect(options).toContain('Abymon Jacob, Jayamole Aby — Membership 239');
    expect(options).toContain('Another Member, Family Member — Membership 240');

    form['selectMatch'](1);
    expect(form['membershipNumber']).toBe('240');
    expect(form['name']).toBe('Another Member, Family Member');
  });

  it('does not allow contact details to be submitted without a roster match', async () => {
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(new Response(
        JSON.stringify({ message: 'No member found for that mobile number.' }),
        { status: 404 },
      )),
    );
    const form = TestBed.createComponent(ContactDetailsForm).componentInstance;
    form['phone'] = '07123456789';

    await form['lookupPhone']();

    expect(form['membershipNumber']).toBe('');
    expect(form['phoneMatchVerified']).toBeFalse();
    expect(form['lookupMessage']).toContain('Check that your phone number');
  });

  it('requires a directory-verified phone and membership match before submitting', async () => {
    const fetchSpy = spyOn(window, 'fetch');
    const fixture = TestBed.createComponent(ContactDetailsForm);
    const form = fixture.componentInstance;
    form['phone'] = '07123456789';
    form['membershipNumber'] = '239';
    fixture.detectChanges();

    await form['submit'](new Event('submit') as SubmitEvent);

    expect(
      fixture.nativeElement.querySelector('.submit-button').disabled,
    ).toBeTrue();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(form['errorMessage']).toContain('Find and select a matching member');

    form['phoneMatchVerified'] = true;
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.submit-button').disabled,
    ).toBeFalse();
  });

  it('verifies the selected membership against the phone lookup', async () => {
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(
          JSON.stringify({
            matches: [{
              membershipNumber: '239',
              names: ['Abymon Jacob'],
              membershipType: 'family',
            }],
          }),
          { status: 200 },
        ),
      ),
    );
    const form = TestBed.createComponent(ContactDetailsForm).componentInstance;
    form['phone'] = '07450903172';

    await form['lookupPhone']();

    expect(form['membershipNumber']).toBe('239');
    expect(form['phoneMatchVerified']).toBeTrue();
    form['onPhoneChanged']();
    expect(form['phoneMatchVerified']).toBeFalse();
  });

  it('shows spouse and child fields only for family membership', async () => {
    const fixture = TestBed.createComponent(ContactDetailsForm);
    const form = fixture.componentInstance;
    form['phone'] = '07450903172';
    const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
      new Response(
        JSON.stringify({
          matches: [{
            membershipNumber: '239',
            names: ['Abymon Jacob'],
            membershipType: 'family',
          }],
        }),
        { status: 200 },
      ),
    );

    await form['lookupPhone']();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.family-details')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="spouseName"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="childName0"]')).not.toBeNull();

    form['onPhoneChanged']();
    form['phone'] = '07123456789';
    fetchSpy.and.resolveTo(
      new Response(
        JSON.stringify({
          matches: [{
            membershipNumber: '509',
            names: ['Latha Kadalayil'],
            membershipType: 'individual',
          }],
        }),
        { status: 200 },
      ),
    );
    await form['lookupPhone']();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.family-details')).toBeNull();
  });

  it('submits spouse and child details with the selected family membership', async () => {
    const fixture = TestBed.createComponent(ContactDetailsForm);
    const form = fixture.componentInstance;
    form['phone'] = '07450903172';
    form['spouseName'] = 'Updated spouse';
    form['spouseAge'] = 35;
    form['spousePhone'] = '07123456789';
    form['children'][0] = { name: 'Child One', age: 8 };
    const fetchSpy = spyOn(window, 'fetch').and.callFake(
      async (input: RequestInfo | URL) =>
        String(input) === '/api/membership-phone-lookup'
          ? new Response(
              JSON.stringify({
                matches: [{
                  membershipNumber: '239',
                  names: ['Abymon Jacob'],
                  membershipType: 'family',
                }],
              }),
              { status: 200 },
            )
          : new Response(JSON.stringify({ message: 'Submitted.' }), { status: 201 }),
    );

    await form['lookupPhone']();
    await form['submit'](new Event('submit') as SubmitEvent);

    const submission = fetchSpy.calls.all().find(
      (call) => String(call.args[0]) === '/api/contact-details-updates',
    );
    expect(JSON.parse(submission?.args[1]?.body as string)).toEqual(
      jasmine.objectContaining({
        membershipType: 'family',
        spouseName: 'Updated spouse',
        spouseAge: 35,
        spousePhone: '07123456789',
        children: jasmine.arrayContaining([
          { name: 'Child One', age: 8 },
        ]),
      }),
    );
  });
});
