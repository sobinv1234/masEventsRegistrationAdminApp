import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Registration } from './registration';

describe('Registration', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Registration],
      providers: [provideZonelessChangeDetection()],
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
});
