export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { image } = req.body || {};

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
                text: `Identifiser gjenstanden på bildet så presist som mulig.

Returner kun JSON med disse feltene:
{
  "name": "navn på gjenstanden",
  "description": "kort beskrivelse",
  "estimated_value_nok": "anslått verdi i norske kroner",
  "confidence": "lav, middels eller høy"
}

Hvis du ikke kan identifisere gjenstanden sikkert, si det tydelig og gi et forsiktig verdiestimat.`
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
        confidence: "lav"
      };
    }

    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({
      error: e.message || "Ukjent feil"
    });
  }
}
