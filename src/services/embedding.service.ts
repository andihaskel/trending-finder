import OpenAI from 'openai';

export class EmbeddingService {
  private openai: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.openai = new OpenAI({
      apiKey,
    });
  }

  /**
   * Generate embedding for text using OpenAI
   * @param text - The text to generate embedding for
   * @returns Promise<number[]> - Array of 1536 floats representing the embedding
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      if (!text || text.trim().length === 0) {
        throw new Error('Text cannot be empty');
      }

      console.log(`Generating embedding for text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

      const response = await this.openai.embeddings.create({
        input: text,
        model: 'text-embedding-3-small',
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('No embedding data received from OpenAI');
      }

      const embedding = response.data[0].embedding;
      
      if (!Array.isArray(embedding) || embedding.length !== 1536) {
        throw new Error(`Invalid embedding format. Expected array of 1536 floats, got: ${typeof embedding} with length ${Array.isArray(embedding) ? embedding.length : 'N/A'}`);
      }

      console.log(`Successfully generated embedding with ${embedding.length} dimensions`);
      
      return embedding;
    } catch (error) {
      console.error('Error generating OpenAI embedding:', error);
      
      // Re-throw the error to let the caller handle it
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * @param texts - Array of texts to generate embeddings for
   * @returns Promise<number[][]> - Array of embeddings
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      if (!texts || texts.length === 0) {
        throw new Error('Texts array cannot be empty');
      }

      console.log(`Generating embeddings for ${texts.length} texts`);

      const response = await this.openai.embeddings.create({
        input: texts,
        model: 'text-embedding-3-small',
      });

      if (!response.data || response.data.length !== texts.length) {
        throw new Error(`Expected ${texts.length} embeddings, but received ${response.data?.length || 0}`);
      }

      const embeddings = response.data.map(item => item.embedding);
      
      // Validate each embedding
      for (let i = 0; i < embeddings.length; i++) {
        const embedding = embeddings[i];
        if (!Array.isArray(embedding) || embedding.length !== 1536) {
          throw new Error(`Invalid embedding at index ${i}. Expected array of 1536 floats, got: ${typeof embedding} with length ${Array.isArray(embedding) ? embedding.length : 'N/A'}`);
        }
      }

      console.log(`Successfully generated ${embeddings.length} embeddings`);
      
      return embeddings;
    } catch (error) {
      console.error('Error generating OpenAI embeddings batch:', error);
      
      // Re-throw the error to let the caller handle it
      throw new Error(`Failed to generate embeddings batch: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if the OpenAI service is available
   * @returns Promise<boolean> - True if service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Try to generate a simple embedding to test the service
      const testEmbedding = await this.generateEmbedding('test');
      return testEmbedding.length === 1536;
    } catch (error) {
      console.error('OpenAI service is not available:', error);
      return false;
    }
  }
}
