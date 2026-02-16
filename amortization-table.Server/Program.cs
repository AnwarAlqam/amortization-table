var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();
// Allow CORS for development (Angular dev server)
builder.Services.AddCors(options =>
{
    options.AddPolicy("DevPolicy", policy =>
    {
        policy.AllowAnyHeader().AllowAnyMethod().AllowAnyOrigin();
    });
});
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
// Register amortization service
builder.Services.AddSingleton<amortization_table.Server.IServices.IAmortizationService, amortization_table.Server.Services.AmortizationService>();

var app = builder.Build();

app.UseDefaultFiles();
app.MapStaticAssets();

// Use CORS for dev
app.UseCors("DevPolicy");

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// HTTPS redirection disabled for HTTP-only development
// app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();

app.MapFallbackToFile("/index.html");

app.Run();
