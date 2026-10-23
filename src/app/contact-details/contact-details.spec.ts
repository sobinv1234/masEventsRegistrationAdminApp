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
            }],
          }),
          { status: 200 },
        ),
      ),
    );
    const form = TestBed.createComponent(ContactDetailsForm).componentInstance;
    form['phone'] = '07450903172';

    await form['lookupPhone']();
    form['selectMatch'](1);

    expect(form['membershipNumber']).toBe('239');
    expect(form['name']).toBe('Jayamole Aby');
    expect(form['email']).toBe('');
  });

  it('allows contact details to be submitted without a roster match', async () => {
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
    expect(form['lookupMessage']).toContain('You can still submit');
  });
});
