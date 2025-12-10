import { NextResponse } from 'next/server';
import { createStoryStream, appendChatHistory } from '../../../services/1';

export async function POST(request: Request) {
  try {
    const { topic = '', username = 'guest', chatId = 'default' } = await request.json();

    const stream = new ReadableStream({
      async start(controller) {
        const completion = await createStoryStream(topic, username, chatId);
        const encoder = new TextEncoder();
        let assistantText = '';
        try {
          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              assistantText += content;
              controller.enqueue(encoder.encode(content));
            }
          }
          await appendChatHistory(username, chatId, [
            { role: 'user', content: topic, timestamp: new Date().toISOString() },
            { role: 'assistant', content: assistantText, timestamp: new Date().toISOString() },
          ]);
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Unknown error' }, { status: 500 });
  }
}
