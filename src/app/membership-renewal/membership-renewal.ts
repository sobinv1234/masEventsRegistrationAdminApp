import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

type MemberOption = { membershipNumber: string; name: string };
type RenewalChild = { name: string; age: number | null };

@Component({
  selector: 'app-membership-renewal',
  imports: [FormsModule, RouterLink],
  templateUrl: './membership-renewal.html',
  styleUrl: './membership-renewal.scss',
})
export class MembershipRenewalForm {
  private readonly changeDetector = inject(ChangeDetectorRef);
  protected mobileNumber = '';
  protected membershipNumber = '';
  protected membershipHolderName = '';
  protected memberOptions: MemberOption[] = [];
  protected selectedMember = -1;
  protected membershipType: 'individual' | 'family' = 'individual';
  protected email = '';
  protected memberAge: number | null = null;
  protected spouseName = '';
  protected spouseAge: number | null = null;
  protected children: RenewalChild[] = Array.from({ length: 4 }, () => ({
    name: '',
    age: null,
  }));
  protected otherFamilyMembers = '';
  protected address = '';
  protected postcode = '';
  protected phone = '';
  protected spousePhone = '';
  protected additionalPhones = '';
  protected consent = false;
  protected lookingUp = false;
  protected submitting = false;
  protected submitted = false;
  protected errorMessage = '';
  protected successMessage = '';

  protected onMobileChanged(): void {
    this.memberOptions = [];
    this.selectedMember = -1;
    this.membershipNumber = '';
    this.membershipHolderName = '';
    this.errorMessage = '';
  }

  protected onMembershipNumberChanged(): void {
    this.memberOptions = [];
    this.selectedMember = -1;
    this.membershipHolderName = '';
    this.errorMessage = '';
  }

  protected async lookupMembershipNumber(): Promise<void> {
    const membershipNumber = this.membershipNumber.trim();
    if (!membershipNumber || this.lookingUp) {
      return;
    }

    this.lookingUp = true;
    this.errorMessage = '';
    try {
      const response = await fetch('/api/membership-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membershipNumber }),
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not look up this membership number.'));
      }
      const result: { names: string[] } = await response.json();
      this.memberOptions = result.names.map((name) => ({
        membershipNumber,
        name,
      }));
      if (this.memberOptions.length === 1) {
        this.selectMember(0);
      }
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the member lookup service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not look up this membership number.';
    } finally {
      this.lookingUp = false;
      this.changeDetector.markForCheck();
    }
  }

  protected async lookupMember(): Promise<void> {
    const mobileNumber = this.mobileNumber.trim();
    if (!mobileNumber || this.lookingUp) {
      return;
    }

    this.lookingUp = true;
    this.errorMessage = '';
    try {
      const response = await fetch('/api/membership-phone-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: mobileNumber }),
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not look up this mobile number.'));
      }
      const result: {
        matches: { membershipNumber: string; names: string[] }[];
      } = await response.json();
      this.memberOptions = result.matches.flatMap((match) =>
        match.names.map((name) => ({
          membershipNumber: match.membershipNumber,
          name,
        })),
      );
      if (this.memberOptions.length === 1) {
        this.selectMember(0);
      } else {
        this.selectedMember = -1;
      }
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the member lookup service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not look up this mobile number.';
    } finally {
      this.lookingUp = false;
      this.changeDetector.markForCheck();
    }
  }

  protected selectMember(index: number): void {
    const member = this.memberOptions[index];
    if (!member) {
      this.membershipNumber = '';
      this.membershipHolderName = '';
      return;
    }
    this.selectedMember = index;
    this.membershipNumber = member.membershipNumber;
    this.membershipHolderName = member.name;
  }

  protected async submitRenewal(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.submitting || this.submitted) {
      return;
    }
    this.errorMessage = '';
    this.successMessage = '';
    this.submitting = true;
    try {
      const response = await fetch('/api/membership-renewals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          membershipNumber: this.membershipNumber,
          membershipHolderName: this.membershipHolderName,
          membershipType: this.membershipType,
          email: this.email,
          memberAge: this.memberAge,
          spouseName: this.spouseName,
          spouseAge: this.spouseAge,
          children: this.children,
          otherFamilyMembers: this.otherFamilyMembers,
          address: this.address,
          postcode: this.postcode,
          phone: this.phone,
          spousePhone: this.spousePhone,
          additionalPhones: this.additionalPhones,
          consent: this.consent,
        }),
      });
      const result: { message?: string } = await response.json();
      if (!response.ok) {
        throw new Error(result.message || 'Could not submit your renewal.');
      }
      this.successMessage =
        result.message || 'Your membership renewal details have been submitted.';
      this.submitted = true;
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the renewal service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not submit your renewal.';
    } finally {
      this.submitting = false;
      this.changeDetector.markForCheck();
    }
  }

  private async getApiError(response: Response, fallback: string): Promise<string> {
    try {
      const result: { message?: string } = await response.json();
      return result.message || fallback;
    } catch {
      return fallback;
    }
  }
}
