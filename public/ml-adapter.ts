import * as ort from 'onnxruntime-web';

export type ModelContract = {
  inputName: string;
  outputName: string;
  featureOrder: string[];
  labels?: string[];
  threshold?: number;
};

export async function runConfiguredOnnx(modelFile: File, contract: ModelContract, features: Record<string, number>) {
  if (!contract?.inputName || !contract?.outputName || !Array.isArray(contract.featureOrder)) throw new Error('Hiányzó vagy érvénytelen modellkontraktus.');
  const values = contract.featureOrder.map((name) => features[name]);
  if (values.some((value) => !Number.isFinite(value))) throw new Error('A modellhez szükséges feature hiányzik.');
  const session = await ort.InferenceSession.create(await modelFile.arrayBuffer(), { executionProviders: ['wasm'] });
  const output = await session.run({ [contract.inputName]: new ort.Tensor('float32', Float32Array.from(values), [1, values.length]) });
  const tensor = output[contract.outputName];
  if (!tensor) throw new Error(`A kontraktusban megadott kimenet hiányzik: ${contract.outputName}`);
  return { values: Array.from(tensor.data as Float32Array), labels: contract.labels ?? [], threshold: contract.threshold ?? null };
}
