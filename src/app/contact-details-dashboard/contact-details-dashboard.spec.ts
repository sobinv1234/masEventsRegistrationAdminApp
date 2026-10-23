import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminSession } from '../admin-dashboard/admin-session';
import { ContactDetailsDashboard } from './contact-details-dashboard';

describe('ContactDetailsDashboard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContactDetailsDashboard],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
    TestBed.inject(AdminSession).authorization = 'Basic test';
  });

  it('exports contact details in an Excel-compatible CSV with formula values escaped', () => {
    const dashboard = TestBed.createComponent(ContactDetailsDashboard).componentInstance;
    dashboard['records'] = [{
      id: 'update-1',
      createdAt: '2026-10-23T10:00:00.000Z',
      phone: '07123456789',
      membershipNumber: '203',
      name: '=Formula',
      email: 'member@example.com',
      address: '1 Test Street',
      consent: true,
    }];

    const csv = dashboard['buildCsv']();

    expect(csv).toContain('"Membership number","Name","Phone","Email","Address"');
    expect(csv).toContain('"203","\'=Formula","07123456789"');
    expect(csv).toContain('"Agreed"');
  });

  it('deletes an entry after confirmation', async () => {
    const dashboard = TestBed.createComponent(ContactDetailsDashboard).componentInstance;
    const record = {
      id: 'a9e1d69a-05b1-4d95-89cd-71b375c1d4ef',
      createdAt: '2026-10-23T10:00:00.000Z',
      phone: '07123456789',
      membershipNumber: '',
      name: 'Test Member',
      email: 'member@example.com',
      address: '1 Test Street',
      consent: true,
    };
    dashboard['records'] = [record];
    const fetchSpy = spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(new Response(null, { status: 204 })),
    );

    dashboard['requestDelete'](record);
    expect(fetchSpy).not.toHaveBeenCalled();
    await dashboard['confirmDialogAction']();

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/admin/contact-details-updates/${record.id}`,
      jasmine.objectContaining({ method: 'DELETE' }),
    );
    expect(dashboard['records']).toEqual([]);
  });
});
