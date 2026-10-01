// HeadForGet.cs
namespace Destidle.Api;

/// <summary>
/// D-03 : ASP.NET Core n'implique pas HEAD pour un MapGet (405 Allow: GET) ; Kestrel omet le corps des réponses HEAD.
/// Convention de groupe (<c>RouteGroupBuilder.Add</c>) : pour chaque endpoint dont la métadonnée
/// <see cref="IHttpMethodMetadata"/> contient GET sans HEAD, cette métadonnée est remplacée en place par une
/// <see cref="HttpMethodMetadata"/> GET + HEAD (même <c>AcceptCorsPreflight</c>) — jamais une seconde entrée.
/// Les endpoints sans GET (POST free/guess/reveal) sont inchangés : leur <c>Allow</c> reste exactement POST.
/// Publique pour être testée directement.
/// </summary>
public static class HeadForGet
{
    public static void Apply(EndpointBuilder eb)
    {
        for (var i = 0; i < eb.Metadata.Count; i++)
        {
            if (eb.Metadata[i] is not IHttpMethodMetadata m) continue;
            if (!m.HttpMethods.Any(HttpMethods.IsGet) || m.HttpMethods.Any(HttpMethods.IsHead)) continue;
            eb.Metadata[i] = new HttpMethodMetadata([.. m.HttpMethods, HttpMethods.Head], m.AcceptCorsPreflight);
        }
    }
}
