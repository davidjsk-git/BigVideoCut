import { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';
import { Upload, Play, Pause, Scissors, Download, Loader2, AlertCircle, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

function cx(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const ffmpegRef = useRef(new FFmpeg());
  
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    loadFFmpeg();
  }, []);

  const loadFFmpeg = async () => {
    const ffmpeg = ffmpegRef.current;
    setLoadError(null);
    
    try {
      console.log('FFmpeg 로딩 시작...');
      
      // SharedArrayBuffer 지원 여부 확인
      const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
      console.log('SharedArrayBuffer 지원:', hasSharedArrayBuffer);
      
      let baseURL: string;
      let config: any;
      
      if (hasSharedArrayBuffer) {
        // SharedArrayBuffer 지원: 멀티스레딩 버전 사용
        baseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';
        console.log('멀티스레딩 버전 로딩...');
        config = {
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
        };
      } else {
        // SharedArrayBuffer 미지원: 단일 스레드 버전 사용
        baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        console.log('단일 스레드 버전 로딩...');
        config = {
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        };
      }
      
      console.log('FFmpeg.load() 시작...');
      await ffmpeg.load(config);
      console.log('FFmpeg 로딩 완료!');
      
      setLoaded(true);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      console.error('FFmpeg 로딩 오류:', errorMsg);
      setLoadError(`FFmpeg 로딩 실패: ${errorMsg}`);
      setLoaded(false);
    }
  };

  const processSelectedFile = (selected: File | undefined | null) => {
    if (selected) {
      if (!selected.type.startsWith('video/')) {
        alert('동영상 파일만 업로드 가능합니다.');
        return;
      }
      setFile(selected);
      // OOM 방지를 위해 브라우저 단에서 URL 객체만 생성
      setVideoUrl(URL.createObjectURL(selected));
      setOutputUrl(null);
      setProgress(0);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processSelectedFile(e.target.files?.[0]);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    processSelectedFile(e.dataTransfer.files?.[0]);
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const d = videoRef.current.duration;
      setDuration(d);
      setRange([0, d]);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      // 선택 구간을 벗어나면 멈추거나 시작 지점으로 되돌림
      if (video.currentTime >= range[1]) {
        video.pause();
        video.currentTime = range[0];
        setIsPlaying(false);
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [range]);

  const handleSliderChange = (val: number | number[]) => {
    if (Array.isArray(val)) {
      setRange([val[0], val[1]]);
      if (videoRef.current) {
        // Handle seeking visually
        if (Math.abs(videoRef.current.currentTime - val[0]) > 1) {
          videoRef.current.currentTime = val[0];
        } else {
          videoRef.current.currentTime = val[1];
        }
      }
    }
  };

  const handleCut = async () => {
    if (!file || !loaded) return;
    const ffmpeg = ffmpegRef.current;
    setIsProcessing(true);
    setProgress(0);
    setOutputUrl(null);

    ffmpeg.on('progress', ({ progress }) => {
      // Progress can sometimes drop below 0 or overshoot, bound it
      setProgress(Math.max(0, Math.min(100, progress * 100)));
    });

    const handleLog = ({ message }: { message: string }) => {
      console.log('FFmpeg Log:', message);
    };
    ffmpeg.on('log', handleLog);

    try {
      // [최적화] 대용량 OOM 방지를 위해 WORKERFS 마운트 사용
      // 메모리에 전체 파일을 올리지 않고 Worker 파일 시스템을 통해 직접 연결
      try { await ffmpeg.createDir('/mnt'); } catch (e) { /* ignore if exists */ }
      await ffmpeg.mount('WORKERFS' as any, { files: [file] }, '/mnt');
      
      const inputPath = `/mnt/${file.name}`;
      const outputPath = 'output.mp4';
      
      // 스트림 복사 방식으로 초고속 자르기 수행 (재인코딩 없음)
      const code = await ffmpeg.exec([
        '-ss', range[0].toString(),
        '-to', range[1].toString(),
        '-i', inputPath,
        '-c', 'copy',
        outputPath
      ]);
      
      if (code !== 0) {
        throw new Error(`FFmpeg exited with code ${code}`);
      }
      
      const data = await ffmpeg.readFile(outputPath) as Uint8Array;
      // 대용량 메모리 공유(SharedArrayBuffer)로 생성된 결과물이 일반 Blob으로 변환되지 못해 다운로드가 안되는 버그 수정
      // 일반 Uint8Array로 복사하여 안전한 Blob(ArrayBuffer) 객체로 생성
      const regularArray = new Uint8Array(data);
      const url = URL.createObjectURL(new Blob([regularArray.buffer], { type: 'video/mp4' }));
      setOutputUrl(url);
      
      await ffmpeg.deleteFile(outputPath);
      await ffmpeg.unmount('/mnt');
    } catch (error) {
      console.error('Error during cutting:', error);
      alert('영상 자르기 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
      setProgress(100);
      ffmpeg.off('progress', () => {});
      ffmpeg.off('log', handleLog);
    }
  };

  const handleDownload = async () => {
    if (!outputUrl) return;
    try {
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: `cut_video_${Date.now()}.mp4`,
            types: [{
              description: 'MP4 Video',
              accept: {'video/mp4': ['.mp4']},
            }],
          });
          
          const writable = await handle.createWritable();
          const response = await fetch(outputUrl);
          if (response.body) {
            // 대용량 파일 스트리밍 최적화: 메모리에 다 올리지 않고 파일 시스템으로 직접 파이프 연결
            await response.body.pipeTo(writable);
          } else {
            const blob = await response.blob();
            await writable.write(blob);
            await writable.close();
          }
          return;
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            console.error('SaveFilePicker API 에러:', err);
          } else {
            return;
          }
        }
      }
      
      const a = document.createElement('a');
      a.href = outputUrl;
      a.download = `cut_video_${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.error(e);
      alert('다운로드 중 문제가 발생했습니다.');
    }
  };

  const handleReset = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setFile(null);
    setVideoUrl(null);
    setDuration(0);
    setRange([0, 0]);
    setIsPlaying(false);
    setProgress(0);
    setOutputUrl(null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6 flex flex-col items-center select-none font-sans">
      <div className="max-w-4xl w-full space-y-8">
        
        <header className="text-center space-y-2 pt-8">
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
            초고속 비디오 커터
          </h1>
          <p className="text-zinc-400 text-lg">
            서버 업로드 없이, OOM 걱정 없이 브라우저에서 안전하게 대용량 비디오 자르기
          </p>
        </header>

        {!loaded ? (
          <div className="flex flex-col items-center justify-center p-12 bg-zinc-900/50 rounded-2xl border border-zinc-800 backdrop-blur-sm">
            {loadError ? (
              <>
                <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
                <p className="text-zinc-300 font-medium tracking-wide">FFmpeg 로딩 실패</p>
                <p className="text-red-400 text-sm mt-2 text-center">{loadError}</p>
                <button
                  onClick={() => {
                    setLoadError(null);
                    loadFFmpeg();
                  }}
                  className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium transition-colors"
                >
                  다시 시도
                </button>
              </>
            ) : (
              <>
                <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mb-4" />
                <p className="text-zinc-300 font-medium tracking-wide">FFmpeg 엔진 로딩 중...</p>
                <p className="text-zinc-500 text-sm mt-2">최초 로딩 시 시간이 다소 소요될 수 있습니다.</p>
              </>
            )}
          </div>
        ) : !videoUrl ? (
          <label 
            className={cx(
              "flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-3xl cursor-pointer transition-all duration-300 group",
              isDragging 
                ? "border-indigo-400 bg-indigo-500/20 scale-105 shadow-[0_0_30px_rgba(99,102,241,0.2)]" 
                : "border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="w-12 h-12 mb-4 text-indigo-400 group-hover:scale-110 transition-transform duration-300" />
              <p className="mb-2 text-lg text-zinc-300 font-semibold">
                클릭하거나 동영상을 여기로 드래그하세요
              </p>
              <p className="text-sm text-zinc-500">최대 4K, 3시간 이상의 대용량 파일 완벽 지원</p>
            </div>
            <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleFileChange} />
          </label>
        ) : (
          <div className="space-y-6 bg-zinc-900/40 p-6 sm:p-8 rounded-3xl border border-zinc-800 shadow-2xl backdrop-blur-md">
            
            <div className="flex justify-end px-2">
              <button
                onClick={handleReset}
                className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white px-4 py-2 rounded-xl hover:bg-zinc-800 transition-colors border border-transparent hover:border-zinc-700"
              >
                <RotateCcw className="w-4 h-4" />
                새로운 영상 선택하기
              </button>
            </div>

            {/* Video Player */}
            <div className="relative aspect-video bg-black rounded-2xl overflow-hidden shadow-inner ring-1 ring-white/10">
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain"
                onLoadedMetadata={handleLoadedMetadata}
                onClick={togglePlay}
              />
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex items-end gap-4 opacity-0 hover:opacity-100 transition-opacity duration-300">
                <button 
                  onClick={togglePlay}
                  className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-white transition-all transform hover:scale-105"
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" fill="currentColor" />}
                </button>
              </div>
            </div>

            {/* Controls */}
            <div className="space-y-6 px-2">
              <div className="flex items-center justify-between text-sm font-medium text-zinc-400 mb-2">
                <span className="bg-zinc-800 px-3 py-1 rounded-lg">구간 시작: {formatTime(range[0])}</span>
                <span className="text-indigo-400 font-bold bg-indigo-500/10 px-3 py-1 rounded-lg">
                  선택 길이: {formatTime(range[1] - range[0])}
                </span>
                <span className="bg-zinc-800 px-3 py-1 rounded-lg">구간 끝: {formatTime(range[1])}</span>
              </div>
              
              <div className="pt-2 pb-6 px-4">
                <Slider
                  range
                  min={0}
                  max={duration}
                  step={0.1}
                  value={range}
                  onChange={handleSliderChange}
                  styles={{
                    track: { backgroundColor: '#818cf8', height: 8 },
                    rail: { backgroundColor: '#3f3f46', height: 8 },
                    handle: {
                      borderColor: '#4f46e5',
                      height: 24,
                      width: 24,
                      marginTop: -8,
                      backgroundColor: '#fff',
                      boxShadow: '0 0 10px rgba(79, 70, 229, 0.5)'
                    }
                  }}
                />
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4">
                <button
                  onClick={handleCut}
                  disabled={isProcessing}
                  className={cx(
                    "flex-1 w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-lg transition-all duration-300 transform",
                    isProcessing 
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" 
                      : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_20px_rgba(79,70,229,0.3)] hover:shadow-[0_0_30px_rgba(79,70,229,0.5)] hover:-translate-y-1"
                  )}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-6 h-6 animate-spin" />
                      자르기 진행 중...
                    </>
                  ) : (
                    <>
                      <Scissors className="w-6 h-6" />
                      이 구간 잘라내기
                    </>
                  )}
                </button>
              </div>

              {isProcessing && (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm text-zinc-400 font-medium">
                    <span>진행률</span>
                    <span>{progress.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-300 relative"
                      style={{ width: `${progress}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                    </div>
                  </div>
                  <p className="text-xs text-center text-zinc-500">스트림 복사 방식으로 초고속 처리 중입니다...</p>
                </div>
              )}

              {outputUrl && !isProcessing && (
                <div className="mt-6 p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center gap-3 text-emerald-400">
                    <AlertCircle className="w-6 h-6" />
                    <p className="font-semibold text-lg">성공적으로 잘라냈습니다!</p>
                  </div>
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold transition-all hover:-translate-y-1 shadow-lg shadow-emerald-900/50"
                  >
                    <Download className="w-5 h-5" />
                    결과물 다운로드
                  </button>
                </div>
              )}
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
}
