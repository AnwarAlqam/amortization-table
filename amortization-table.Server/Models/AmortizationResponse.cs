namespace amortization_table.Server.Models
{
    public class AmortizationResponse
    {
        public double beginningBalance { get; set; }
        public double endingBalance { get; set; }
        public double interest { get; set; }
        public double principal { get; set; }
        public double payment { get; set; }
    }
}
