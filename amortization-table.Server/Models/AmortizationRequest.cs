namespace amortization_table.Server.Models
{
    public class AmortizationRequest
    {
        public double interest { get; set; }
        public double purchasePrice { get; set; }
        public double downPayment { get; set; }
        public int? term { get; set; }
        public double? paymentFrequency { get; set; }
        public string? termType { get; set; }
        public DateTime? loanStartDate { get; set; }
        public AmortizationRequest() { }

    }
}
