export class AmortizationRequest {

  public interest: number | undefined;
  public purchasePrice: number | undefined;
  public downPayment: number | undefined;
  public term: number | undefined;
  public paymentFrequency: number | undefined;
  public termType?: 'Week' | 'Month' | 'Year';
  public loanStartDate?: string | null;

}
