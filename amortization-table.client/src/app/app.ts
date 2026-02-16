import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectorRef,
  Component,
  OnInit,
  ViewEncapsulation,
  signal
} from '@angular/core';
import { finalize, timeout } from 'rxjs';
import { AmortizationRequest } from '../shared/models/AmortizationRequest';
import { AmortizationResponse } from '../shared/models/AmortizationResponse';
import { MatTableDataSource } from '@angular/material/table';

import * as XLSX from 'xlsx';

type TermType = 'Week' | 'Month' | 'Year';

type ColumnKey =
  | 'termMonth'
  | 'beginningBalance'
  | 'payment'
  | 'interest'
  | 'totalInterestPaid'
  | 'principal'
  | 'endingBalance';

type SortDirection = 'asc' | 'desc' | null;
type MenuX = 'before' | 'after';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.css',
  encapsulation: ViewEncapsulation.None
})
export class App implements OnInit {
  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) { }

  // -----------------------
  // Guardrails (client-side)
  // -----------------------
  private readonly MAX_YEARS_CAP = 100;          // matches backend cap
  private readonly MAX_INTEREST_PERCENT = 1000;  // safety cap (1000% is already insane)
  private readonly HTTP_TIMEOUT_MS = 20000;      // prevent "hang forever" if server stalls
  private readonly MAX_UI_ROWS = 10000;          // extra safety (backend should stay well below)

  // -----------------------
  // Term type + optional start date
  // -----------------------
  public termType: TermType = 'Month';
  public readonly termTypeOptions: TermType[] = ['Week', 'Month', 'Year'];
  public loanStartDate: Date | null = null;

  // numeric form fields
  public purchasePrice: number | null = null;
  public downPayment: number | null = null;
  public interestRate: number | null = null;

  // display strings (for comma formatting)
  public purchasePriceText = '';
  public downPaymentText = '';
  public paymentFrequencyText = '';

  // One-of-two required: Payment OR Term
  public paymentFrequency: number | null = null;
  public term: number | null = null;
  public paymentFrequencyDisabled = false;
  public termDisabled = false;

  public errorMessage: string | null = null;
  public isLoading = false;

  // Data
  private allRows: AmortizationResponse[] = [];
  public dataSource: MatTableDataSource<AmortizationResponse> =
    new MatTableDataSource<AmortizationResponse>([]);
  public hasResults = false;

  public displayedColumns: string[] = [
    'termMonth',
    'beginningBalance',
    'payment',
    'interest',
    'totalInterestPaid',
    'principal',
    'endingBalance'
  ];

  // Per-column filter values
  public columnFilters: Record<ColumnKey, string> = {
    termMonth: '',
    beginningBalance: '',
    payment: '',
    interest: '',
    totalInterestPaid: '',
    principal: '',
    endingBalance: ''
  };

  // Menu state
  public activeColumnMenu: ColumnKey | null = null;
  public menuXPosition: MenuX = 'after';

  // Sort state
  public sortColumn: ColumnKey | null = null;
  public sortDirection: SortDirection = null;

  // Theme
  public isDark = false;

  protected readonly title = signal('amortization-table.client');

  ngOnInit() {
    const saved = localStorage.getItem('amortization_theme');
    this.isDark = saved === 'dark';
    this.applyThemeClass();
  }

  // -----------------------
  // Labels / UI helpers
  // -----------------------
  public paymentLabel(): string {
    const suffix =
      this.termType === 'Week' ? 'weekly' :
        this.termType === 'Month' ? 'monthly' : 'yearly';
    return `Payment (${suffix})`;
  }

  public termLabel(): string {
    const units =
      this.termType === 'Week' ? 'weeks' :
        this.termType === 'Month' ? 'months' : 'years';
    return `Term (${units})`;
  }

  public termColumnHeader(): string {
    return `Term (${this.termType})`;
  }

  public onTermTypeChange(next: TermType) {
    this.termType = next;

    // Meaning of term/payment changes; reset those fields + results.
    this.paymentFrequency = null;
    this.paymentFrequencyText = '';
    this.term = null;
    this.paymentFrequencyDisabled = false;
    this.termDisabled = false;

    this.errorMessage = null;
    this.resetResults();
  }

  public onLoanStartDateChange() {
    if (this.allRows?.length) this.applyFiltersAndSort();
  }

  private resetResults() {
    this.allRows = [];
    this.dataSource = new MatTableDataSource<AmortizationResponse>([]);
    this.hasResults = false;
  }

  // -----------------------
  // Theme
  // -----------------------
  public toggleTheme() {
    this.isDark = !this.isDark;
    localStorage.setItem('amortization_theme', this.isDark ? 'dark' : 'light');
    this.applyThemeClass();
  }

  private applyThemeClass() {
    document.body.classList.toggle('dark-theme', this.isDark);
  }

  // -----------------------
  // Export (Excel)
  // -----------------------
  public exportToExcel() {
    if (!this.hasResults) return;

    const viewRows = (this.dataSource?.data ?? []) as any[];

    const termHeader = this.termColumnHeader();

    const headerRow = [
      termHeader,
      'Beginning Balance',
      'Payment',
      'Interest',
      'Total Interest Paid',
      'Principal',
      'Ending Balance'
    ];

    const dataRows = viewRows.map((r) => ([
      this.getTermLabel(r),
      Number(r.beginningBalance ?? 0),
      Number(r.payment ?? 0),
      Number(r.interest ?? 0),
      Number(this.getTotalInterestPaid(r) ?? 0),
      Number(r.principal ?? 0),
      Number(r.endingBalance ?? 0)
    ]));

    const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);

    ws['!cols'] = [
      { wch: 22 },
      { wch: 18 },
      { wch: 12 },
      { wch: 12 },
      { wch: 20 },
      { wch: 12 },
      { wch: 16 }
    ];

    const ref = ws['!ref'];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        for (let c = 1; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (!cell) continue;

          if (typeof cell.v === 'number') {
            cell.t = 'n';
            cell.z = '0.00';
          }
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule');

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `amortization-${this.termType.toLowerCase()}-${stamp}.xlsx`);
  }

  // -----------------------
  // Column menu
  // -----------------------
  public prepareColumnMenu(col: ColumnKey, event: MouseEvent) {
    this.activeColumnMenu = col;

    const clickX = event.clientX;
    const w = window.innerWidth || 1200;
    this.menuXPosition = clickX > w * 0.65 ? 'before' : 'after';
  }

  public activeCol(): ColumnKey {
    return (this.activeColumnMenu ?? 'beginningBalance') as ColumnKey;
  }

  public cycleSort(col: ColumnKey) {
    if (this.sortColumn !== col || !this.sortDirection) {
      this.sortColumn = col;
      this.sortDirection = 'asc';
    } else if (this.sortDirection === 'asc') {
      this.sortDirection = 'desc';
    } else {
      this.sortColumn = null;
      this.sortDirection = null;
    }
    this.applyFiltersAndSort();
  }

  public sortLabel(col: ColumnKey): string {
    if (this.sortColumn !== col || !this.sortDirection) return 'Sort: None';
    return this.sortDirection === 'asc' ? 'Sort: Asc ↑' : 'Sort: Desc ↓';
  }

  public setColumnFilter(col: ColumnKey, value: string) {
    this.columnFilters[col] = (value ?? '').toString();
    this.applyFiltersAndSort();
  }

  public clearColumnFilter(col: ColumnKey) {
    this.columnFilters[col] = '';
    this.applyFiltersAndSort();
  }

  public clearAllFilters() {
    (Object.keys(this.columnFilters) as ColumnKey[]).forEach(k => (this.columnFilters[k] = ''));
    this.applyFiltersAndSort();
  }

  public hasAnyFilters(): boolean {
    return (Object.values(this.columnFilters) || []).some(v => (v ?? '').trim().length > 0);
  }

  public isColumnFiltered(col: ColumnKey): boolean {
    return (this.columnFilters[col] ?? '').trim().length > 0;
  }

  public isColumnSorted(col: ColumnKey): boolean {
    return this.sortColumn === col && !!this.sortDirection;
  }

  // -----------------------
  // Helpers to read decorated fields
  // -----------------------
  public getTermMonth(row: AmortizationResponse): number {
    return (row as any).__termMonth ?? 0;
  }

  public getTermLabel(row: AmortizationResponse): string {
    return (row as any).__termLabel ?? String(this.getTermMonth(row));
  }

  public getTotalInterestPaid(row: AmortizationResponse): number {
    return (row as any).__totalInterestPaid ?? 0;
  }

  // -----------------------
  // Filtering: numeric-safe
  // -----------------------
  private toComparableNumber(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;

    const s = String(raw).trim();
    if (!s) return null;

    const cleaned = s.replace(/,/g, '').replace(/[^\d.\-]/g, '');
    if (!cleaned) return null;

    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  private parseFilterAsNumber(filter: string): number | null {
    const f = (filter ?? '').trim();
    if (!f) return null;
    const cleaned = f.replace(/,/g, '').replace(/[^\d.\-]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  private matchesColumnFilter(col: ColumnKey, row: AmortizationResponse, filter: string): boolean {
    const f = (filter ?? '').trim();
    if (!f) return true;

    if (col === 'termMonth') {
      const val = String((row as any).__termMonth ?? '');
      return val.includes(f);
    }

    const filterNum = this.parseFilterAsNumber(f);
    if (filterNum === null) return true;

    let rawVal: any;
    if (col === 'totalInterestPaid') rawVal = (row as any).__totalInterestPaid;
    else rawVal = (row as any)[col];

    const valNum = this.toComparableNumber(rawVal);
    if (valNum === null) return false;

    const valStr = valNum.toFixed(2);
    const filterStr = filterNum.toString();
    return valStr.includes(filterStr);
  }

  // -----------------------
  // Term label date math
  // -----------------------
  private addPeriods(base: Date, offset: number): Date {
    const d = new Date(base.getTime());

    if (this.termType === 'Week') {
      d.setDate(d.getDate() + offset * 7);
      return d;
    }

    if (this.termType === 'Month') {
      d.setMonth(d.getMonth() + offset);
      return d;
    }

    d.setFullYear(d.getFullYear() + offset);
    return d;
  }

  private formatTermDate(d: Date): string {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
  }

  private buildTermLabel(termNumber: number): string {
    if (!this.loanStartDate) return String(termNumber);
    const d = this.addPeriods(this.loanStartDate, termNumber - 1);
    return `${termNumber} (${this.formatTermDate(d)})`;
  }

  // -----------------------
  // Apply filters/sort + decorate rows
  // -----------------------
  private applyFiltersAndSort() {
    let runningInterest = 0;

    const decorated = (this.allRows ?? []).map((r, i) => {
      const copy: any = { ...r };

      copy.__termMonth = i + 1;
      copy.__termLabel = this.buildTermLabel(i + 1);

      const interestVal = this.toComparableNumber((r as any).interest) ?? 0;
      runningInterest += interestVal;
      copy.__totalInterestPaid = runningInterest;

      return copy as AmortizationResponse;
    });

    let rows = decorated.filter(r => {
      return (
        this.matchesColumnFilter('termMonth', r, this.columnFilters.termMonth) &&
        this.matchesColumnFilter('beginningBalance', r, this.columnFilters.beginningBalance) &&
        this.matchesColumnFilter('payment', r, this.columnFilters.payment) &&
        this.matchesColumnFilter('interest', r, this.columnFilters.interest) &&
        this.matchesColumnFilter('totalInterestPaid', r, this.columnFilters.totalInterestPaid) &&
        this.matchesColumnFilter('principal', r, this.columnFilters.principal) &&
        this.matchesColumnFilter('endingBalance', r, this.columnFilters.endingBalance)
      );
    });

    if (this.sortColumn && this.sortDirection) {
      const col = this.sortColumn;
      const dir = this.sortDirection;

      rows = rows.slice().sort((a: any, b: any) => {
        let cmp = 0;

        if (col === 'termMonth') {
          cmp = Number(a.__termMonth ?? 0) - Number(b.__termMonth ?? 0);
        } else if (col === 'totalInterestPaid') {
          cmp = Number(a.__totalInterestPaid ?? 0) - Number(b.__totalInterestPaid ?? 0);
        } else {
          const av = this.toComparableNumber(a[col]);
          const bv = this.toComparableNumber(b[col]);
          const aIsNum = av !== null;
          const bIsNum = bv !== null;

          if (aIsNum && bIsNum) cmp = (av as number) - (bv as number);
          else cmp = String(a[col] ?? '').localeCompare(String(b[col] ?? ''));
        }

        return dir === 'asc' ? cmp : -cmp;
      });
    }

    this.dataSource = new MatTableDataSource<AmortizationResponse>(rows);
    this.hasResults = rows.length > 0;
  }

  // -----------------------
  // Guardrail helpers
  // -----------------------
  private periodsPerYearForType(t: TermType): number {
    if (t === 'Week') return 52;
    if (t === 'Year') return 1;
    return 12; // Month
  }

  private maxAllowedPeriods(): number {
    return this.periodsPerYearForType(this.termType) * this.MAX_YEARS_CAP;
  }

  private isFiniteNumber(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n);
  }

  private validateInputs(): string | null {
    // Required numeric fields
    if (!this.isFiniteNumber(this.purchasePrice) || !this.isFiniteNumber(this.downPayment) || !this.isFiniteNumber(this.interestRate)) {
      return 'Purchase Price, Down Payment, and Interest Rate are required.';
    }

    if (this.purchasePrice < 0) return 'Purchase Price must be ≥ 0.';
    if (this.downPayment < 0) return 'Down Payment must be ≥ 0.';
    if (this.downPayment > this.purchasePrice) return 'Down Payment cannot exceed Purchase Price.';
    if (this.interestRate < 0) return 'Interest Rate must be ≥ 0.';
    if (this.interestRate > this.MAX_INTEREST_PERCENT) return `Interest Rate is too large. Please use a value ≤ ${this.MAX_INTEREST_PERCENT}%.`;

    const principal = this.purchasePrice - this.downPayment;

    // if principal is 0, we can still allow schedule, but it’s basically nothing to amortize
    if (!Number.isFinite(principal) || principal < 0) return 'Invalid principal amount. Check Purchase Price and Down Payment.';

    const hasPayment = this.isFiniteNumber(this.paymentFrequency) && this.paymentFrequency > 0;
    const hasTerm = this.isFiniteNumber(this.term) && this.term > 0;

    if (hasPayment && hasTerm) {
      return 'Please provide either Payment OR Term (not both).';
    }

    if (!hasPayment && !hasTerm) {
      return `Provide either Payment (${this.termType.toLowerCase()}) OR Term (${this.termType.toLowerCase()}). One is required.`;
    }

    const maxPeriods = this.maxAllowedPeriods();

    if (hasTerm) {
      const termInt = Math.floor(this.term as number);
      if (termInt <= 0) return 'Term must be a positive whole number.';
      if (termInt > maxPeriods) {
        return `Term is too large for ${this.termType}. Max allowed is ${maxPeriods} ${this.termType.toLowerCase()}s (=${this.MAX_YEARS_CAP} years).`;
      }
    }

    if (hasPayment) {
      const pay = this.paymentFrequency as number;
      if (!Number.isFinite(pay) || pay <= 0) return 'Payment must be > 0.';

      // If user did NOT supply term, ensure payoff within cap (prevents huge schedules / RAM blowups).
      if (!hasTerm && principal > 0) {
        const ppy = this.periodsPerYearForType(this.termType);
        const r = (this.interestRate as number) / 100 / ppy;

        // payment must cover starting interest (otherwise amortization never reduces principal)
        const startInterest = principal * r;
        const epsilon = 1e-9;
        if (r > 0 && pay <= startInterest + epsilon) {
          return 'Payment is too low to cover interest. Increase payment or lower interest rate.';
        }

        // estimate number of periods needed
        let estPeriods: number;

        if (r === 0) {
          estPeriods = principal / pay;
        } else {
          // n = -ln(1 - rP/A) / ln(1+r)
          const ratio = (r * principal) / pay; // < 1 guaranteed by check above
          const inside = 1 - ratio;
          if (inside <= 0) {
            return 'Payment is too low to amortize the loan. Increase payment or lower interest rate.';
          }

          estPeriods = -Math.log(inside) / Math.log(1 + r);
        }

        if (!Number.isFinite(estPeriods) || estPeriods <= 0) {
          return 'Inputs produce an invalid payoff estimate. Please adjust Payment/Interest.';
        }

        if (estPeriods > maxPeriods) {
          return `With the current payment, payoff would take ~${Math.ceil(estPeriods)} ${this.termType.toLowerCase()}s, which exceeds the ${this.MAX_YEARS_CAP}-year safety cap. Increase payment or provide a term.`;
        }
      }
    }

    return null;
  }

  private extractHttpErrorMessage(err: unknown): string {
    // Try to surface backend messages (ProblemDetails/detail/string/etc.)
    const fallback = 'Failed to calculate schedule. Check console for details.';

    if (!(err instanceof HttpErrorResponse)) return fallback;

    const e: any = err;

    // Common: { detail: "...", title: "...", ... }
    if (e?.error?.detail && typeof e.error.detail === 'string') return e.error.detail;

    // Sometimes server returns plain string
    if (typeof e?.error === 'string' && e.error.trim()) return e.error;

    // Sometimes: { message: "..." }
    if (e?.error?.message && typeof e.error.message === 'string') return e.error.message;

    // HttpErrorResponse.message
    if (typeof e?.message === 'string' && e.message.trim()) return e.message;

    return fallback;
  }

  // -----------------------
  // Backend call
  // -----------------------
  calculateAmortizationSchedule() {
    this.errorMessage = null;

    if (this.isLoading) return;

    const validationError = this.validateInputs();
    if (validationError) {
      this.errorMessage = validationError;
      return;
    }

    const hasPayment = this.paymentFrequency != null && this.paymentFrequency > 0;
    const hasTerm = this.term != null && this.term > 0;

    const request = new AmortizationRequest();
    request.interest = this.interestRate ?? undefined;
    request.purchasePrice = this.purchasePrice ?? undefined;
    request.downPayment = this.downPayment ?? undefined;
    request.paymentFrequency = hasPayment ? this.paymentFrequency! : undefined;
    request.term = hasTerm ? Math.floor(this.term!) : undefined;

    request.termType = this.termType;
    request.loanStartDate = this.loanStartDate ? this.loanStartDate.toISOString() : null;

    const backendBase = 'http://localhost:5284';
    const url = `${backendBase}/Amortization/CalculateAmortizationSchedule`;
    const headers = new HttpHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' });

    this.isLoading = true;

    this.http.post<AmortizationResponse[]>(url, request, { headers })
      .pipe(
        timeout(this.HTTP_TIMEOUT_MS),
        finalize(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (result) => {
          try {
            const rows = result || [];

            // extra UI safety: never try to render enormous datasets
            if (rows.length > this.MAX_UI_ROWS) {
              this.resetResults();
              this.errorMessage = `Schedule is too large to display (${rows.length} rows). Please reduce term or increase payment.`;
              return;
            }

            this.allRows = rows;
            this.applyFiltersAndSort();
          } catch (e) {
            console.error('UI processing error:', e);
            this.errorMessage = 'Received data, but UI processing failed. See console.';
          }
        },
        error: (err) => {
          console.error(err);
          this.resetResults();
          this.errorMessage = this.extractHttpErrorMessage(err);
        }
      });
  }

  // -----------------------
  // Input formatting helpers (commas)
  // -----------------------
  private toNumber(raw: string): number | null {
    const s = (raw ?? '').toString().trim();
    if (!s) return null;

    // allow digits and decimal; commas ok; strip everything else
    const cleaned = s.replace(/,/g, '').replace(/[^\d.]/g, '');
    if (!cleaned) return null;

    const parts = cleaned.split('.');
    const normalized = parts.length <= 1 ? parts[0] : `${parts[0]}.${parts.slice(1).join('')}`;

    const n = Number(normalized);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  private formatMoney(n: number): string {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }

  private formatPlain(n: number): string {
    return n.toFixed(2);
  }

  // Purchase Price
  onPurchasePriceChange(text: string) {
    this.purchasePriceText = text;
    this.purchasePrice = this.toNumber(text);
  }
  onPurchasePriceFocus() {
    if (this.purchasePrice != null) this.purchasePriceText = this.formatPlain(this.purchasePrice);
  }
  onPurchasePriceBlur() {
    if (this.purchasePrice != null) this.purchasePriceText = this.formatMoney(this.purchasePrice);
  }

  // Down Payment
  onDownPaymentChange(text: string) {
    this.downPaymentText = text;
    this.downPayment = this.toNumber(text);
  }
  onDownPaymentFocus() {
    if (this.downPayment != null) this.downPaymentText = this.formatPlain(this.downPayment);
  }
  onDownPaymentBlur() {
    if (this.downPayment != null) this.downPaymentText = this.formatMoney(this.downPayment);
  }

  // Payment (per selected term type) + mutual exclusion
  onPaymentFrequencyChange(text: string) {
    this.paymentFrequencyText = text;
    const n = this.toNumber(text);

    if (n != null && n > 0) {
      this.paymentFrequency = n;
      this.term = null;
      this.termDisabled = true;
      this.paymentFrequencyDisabled = false;
    } else {
      this.paymentFrequency = null;
      this.termDisabled = false;
    }
  }
  onPaymentFrequencyFocus() {
    if (this.paymentFrequency != null) this.paymentFrequencyText = this.formatPlain(this.paymentFrequency);
  }
  onPaymentFrequencyBlur() {
    if (this.paymentFrequency != null) this.paymentFrequencyText = this.formatMoney(this.paymentFrequency);
  }

  // Term (int) + mutual exclusion
  private parsePositiveInt(raw: string): number | null {
    const s = (raw ?? '').toString().trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
  }

  onTermInput(value: string) {
    const val = this.parsePositiveInt(value);

    if (val != null) {
      this.term = val;

      this.paymentFrequency = null;
      this.paymentFrequencyText = '';

      this.paymentFrequencyDisabled = true;
      this.termDisabled = false;
    } else {
      this.term = null;
      this.paymentFrequencyDisabled = false;
    }
  }
}
