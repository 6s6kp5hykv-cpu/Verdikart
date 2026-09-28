export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { image, description } = req.body || {};

    if (!image || typeof image !== "string") {
      return res.status(400).json({
        error: "Mangler bilde"
      });
    }

    if (!image.startsWith("data:image/")) {
      return res.status(400).json({
        error: "Ugyldig bildeformat"
      });
    }

    const userDescription =
      typeof description === "string"
        ? description.trim()
        : "";

    const contextText = userDescription
      ? `
Brukeren har også skrevet følgende informasjon om gjenstanden:

"${userDescription}"

Bruk denne informasjonen som ekstra hjelp til identifisering og verdivurdering.
Hvis informasjonen brukeren har skrevet virker feil eller motsier det som kan sees på bildet, skal du ikke blindt stole på den.
`
      : `
Brukeren har ikke gitt noen ekstra informasjon om gjenstanden.
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Du er ekspert på identifisering og verdivurdering av gjenstander.

Identifiser gjenstanden på bildet så presist som mulig.

${contextText}

Vurder spesielt:
- merke
- modell
- produsent
- type gjenstand
- alder eller produksjonsperiode
- materiale
- spesielle kjennetegn
- eventuell samlerverdi
- tilstand dersom dette kan vurderes fra bildet

Gi et forsiktig og realistisk verdiestimat i norske kroner.

Ikke finn på detaljer som ikke kan underbygges av bildet eller brukerens informasjon.

Hvis flere identifikasjoner er mulige, velg den mest sannsynlige og forklar usikkerheten kort.

Returner KUN gyldig JSON med disse feltene:

{
  "name": "navn på gjenstanden",
  "description": "kort beskrivelse av gjenstanden og hvorfor den er identifisert slik",
  "estimated_value_nok": "anslått verdi i norske kroner",
  "confidence": "lav, middels eller høy",
  "condition": "kort vurdering av tilstanden"
}

Hvis du ikke kan identifisere gjenstanden sikkert, si det tydelig og bruk et forsiktig verdiestimat.`
              },
              {
                type: "input_image",
                image_url: image,
                detail: "high"
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: data?.error?.message || "OpenAI-feil"
      });
    }

    const text =
      data.output
        ?.find(item => item.type === "message")
        ?.content
        ?.find(item => item.type === "output_text")
        ?.text || "";

    if (!text) {
      return res.status(500).json({
        error: "AI returnerte ikke noe svar"
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        name: "Ukjent",
        description: text,
        estimated_value_nok: null,
        confidence: "lav",
        condition: ""
      };
    }

    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({
      error: e.message || "Ukjent feil"
    });
  }
}
