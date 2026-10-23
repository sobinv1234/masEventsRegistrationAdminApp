import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardHome } from './dashboard-home';

describe('DashboardHome', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardHome],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
  });

  it('shows registration entries as progress against the directory', () => {
    const fixture = TestBed.createComponent(DashboardHome);
    const dashboard = fixture.componentInstance;
    dashboard['loggedIn'] = true;
    dashboard['members'] = [
      { membershipNumber: '20', names: ['Member One'], phones: [], email: '' },
      { membershipNumber: '21', names: ['Member Two'], phones: [], email: '' },
      { membershipNumber: '22', names: ['Member Three'], phones: [], email: '' },
      { membershipNumber: '23', names: ['Member Four'], phones: [], email: '' },
    ];
    dashboard['registrations'] = [
      { membershipNumber: '20' },
      { membershipNumber: '20' },
      { membershipNumber: '21' },
      {},
      {},
    ];
    fixture.detectChanges();

    expect(dashboard['registeredMembershipCount']).toBe(2);
    expect(dashboard['registrationProgress']).toBe(100);
    expect(fixture.nativeElement.querySelector('.progress-percent').textContent.trim())
      .toBe('100%');
    expect(fixture.nativeElement.querySelector('.progress-labels').textContent)
      .toContain('5 registrations');
  });

  it('searches the member directory by name, membership number, phone, and email', () => {
    const fixture = TestBed.createComponent(DashboardHome);
    const dashboard = fixture.componentInstance;
    dashboard['members'] = [
      {
        membershipNumber: '20',
        names: ['Member One', 'Family Member'],
        phones: ['07123456789'],
        email: 'member@example.com',
        address: '1 Test Street',
      },
      { membershipNumber: '21', names: ['Other Member'], phones: [], email: '' },
    ];
    dashboard['searchTerm'] = '071234';
    expect(dashboard['filteredMembers'].map((member) => member.membershipNumber)).toEqual([
      '20',
    ]);

    dashboard['searchTerm'] = 'family member';
    expect(dashboard['filteredMembers'].map((member) => member.membershipNumber)).toEqual([
      '20',
    ]);

    dashboard['searchTerm'] = 'member@example.com';
    expect(dashboard['filteredMembers'].map((member) => member.membershipNumber)).toEqual([
      '20',
    ]);

    dashboard['searchTerm'] = 'test street';
    expect(dashboard['filteredMembers'].map((member) => member.membershipNumber)).toEqual([
      '20',
    ]);
  });

  it('builds an Excel-compatible member CSV with addresses and formula values escaped', () => {
    const dashboard = TestBed.createComponent(DashboardHome).componentInstance;
    dashboard['members'] = [
      {
        membershipNumber: '20',
        names: ['=Formula'],
        phones: ['07123456789'],
        email: 'member@example.com',
        address: '1 Test Street',
      },
    ];

    const csv = dashboard['buildCsv']();

    expect(csv).toContain('"Membership number","Member name(s)","Phone number(s)","Email address","Address"');
    expect(csv).toContain('"20","\'=Formula","07123456789","member@example.com","1 Test Street"');
  });

  it('shows the additional member information supplied in a renewal', () => {
    const fixture = TestBed.createComponent(DashboardHome);
    const dashboard = fixture.componentInstance;
    dashboard['loggedIn'] = true;
    dashboard['members'] = [
      {
        membershipNumber: '20',
        names: ['Member One'],
        phones: ['07123456789'],
        email: 'member@example.com',
        address: '1 Test Street, SO53 2PL',
        renewalDetails: {
          membershipType: 'family',
          memberAge: 40,
          spouseName: 'Family Member',
          spouseAge: 38,
          children: [{ name: 'Child One', age: 10 }],
          otherFamilyMembers: 'Grandparent (65)',
          postcode: 'SO53 2PL',
          spousePhone: '07111222333',
          additionalPhones: 'Uncle: 07222333444',
        },
      },
    ];
    fixture.detectChanges();

    const detailsCell = fixture.nativeElement.querySelector(
      'tbody tr td:last-child',
    ) as HTMLTableCellElement;
    expect(detailsCell.textContent).toContain('family membership');
    expect(detailsCell.textContent).toContain('Family Member (38)');
    expect(detailsCell.textContent).toContain('Child One (10)');
    expect(detailsCell.textContent).toContain('Grandparent (65)');
  });

  it('uses the latest submitted contact address for its membership', async () => {
    const dashboard = TestBed.createComponent(DashboardHome).componentInstance;
    dashboard['members'] = [
      { membershipNumber: '20', names: ['Member One'], phones: [], email: '' },
    ];
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(JSON.stringify([
          {
            membershipNumber: '20',
            address: 'Latest address',
            email: 'latest@example.com',
          },
          {
            membershipNumber: '20',
            address: 'Earlier address',
            email: 'earlier@example.com',
          },
        ])),
      ),
    );

    await dashboard['loadMemberAddresses']({ Authorization: 'Basic test' });

    expect(dashboard['members'][0].address).toBe('Latest address');
    expect(dashboard['members'][0].email).toBe('latest@example.com');
  });

  it('keeps the renewal address when no contact-details update exists', async () => {
    const dashboard = TestBed.createComponent(DashboardHome).componentInstance;
    dashboard['members'] = [
      {
        membershipNumber: '20',
        names: ['Member One'],
        phones: [],
        email: '',
        address: 'Renewal address, SO53 2PL',
      },
    ];
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(new Response(JSON.stringify([]))),
    );

    await dashboard['loadMemberAddresses']({ Authorization: 'Basic test' });

    expect(dashboard['members'][0].address).toBe('Renewal address, SO53 2PL');
  });

  it('keeps a newer renewal address instead of an older contact-details address', async () => {
    const dashboard = TestBed.createComponent(DashboardHome).componentInstance;
    dashboard['members'] = [
      {
        membershipNumber: '20',
        names: ['Member One'],
        phones: [],
        email: 'renewal@example.com',
        address: 'Latest renewal address',
        addressUpdatedAt: '2026-10-22T12:00:00.000Z',
      },
    ];
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(JSON.stringify([
          {
            membershipNumber: '20',
            address: 'Old contact address',
            email: 'old-contact@example.com',
            createdAt: '2026-10-20T12:00:00.000Z',
          },
        ])),
      ),
    );

    await dashboard['loadMemberAddresses']({ Authorization: 'Basic test' });

    expect(dashboard['members'][0].address).toBe('Latest renewal address');
    expect(dashboard['members'][0].email).toBe('renewal@example.com');
  });

  it('includes the full event calendar and registration navigation', () => {
    const fixture = TestBed.createComponent(DashboardHome);
    const dashboard = fixture.componentInstance;
    dashboard['loggedIn'] = true;
    fixture.detectChanges();

    expect(dashboard['events'].length).toBe(12);
    expect(fixture.nativeElement.querySelector('a[routerlink="/admin/board-games"]'))
      .not.toBeNull();
    expect(fixture.nativeElement.querySelector('.download-button')).not.toBeNull();
  });
});
