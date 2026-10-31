import { describe, expect, it } from 'vitest';
import { humanizeError } from '../../src/knowledge/ui';

describe('humanizeError', () => {
  it('把 SenseVoice 的 funasr 缺失提示为对应引擎依赖', () => {
    const message = humanizeError("转文字失败：ModuleNotFoundError: No module named 'funasr'");
    expect(message).toContain('SenseVoice 环境缺少依赖');
    expect(message).toContain('pip install funasr torch torchaudio');
    expect(message).not.toContain('Whisper 模型');
  });

  it('Whisper 自身错误仍提示检查 Whisper 档位', () => {
    expect(humanizeError('faster-whisper model download failed')).toContain('Whisper 模型');
  });

  it('未知 Python 模块不再误归因到 Whisper', () => {
    const message = humanizeError("ModuleNotFoundError: No module named 'modelscope'");
    expect(message).toContain('缺少转写依赖');
    expect(message).not.toContain('Whisper 模型');
  });
});
