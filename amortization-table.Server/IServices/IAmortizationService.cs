using amortization_table.Server.Models;

namespace amortization_table.Server.IServices
{
    public interface IAmortizationService
    {
        List<AmortizationResponse> CalculateAmortizationSchedule(AmortizationRequest request);
    }
}
