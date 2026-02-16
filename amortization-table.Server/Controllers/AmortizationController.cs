using Microsoft.AspNetCore.Mvc;
using amortization_table.Server.IServices;


namespace amortization_table.Server.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class AmortizationController : ControllerBase
    {
        private readonly IAmortizationService _amortizationService;

        public AmortizationController(IAmortizationService amortizationService)
        {
            _amortizationService = amortizationService;
        }

        // POST /Amortization/CalculateAmortizationSchedule
        [HttpPost("CalculateAmortizationSchedule")]
        public ActionResult<List<Models.AmortizationResponse>> CalculateAmortizationSchedule([FromBody] Models.AmortizationRequest request)
        {
            if (request == null)
            {
                return BadRequest();
            }

            var result = _amortizationService.CalculateAmortizationSchedule(request);
            return Ok(result);
        }
    }


}
