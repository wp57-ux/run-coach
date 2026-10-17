# Records the voice cues with a built-in Windows voice.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File tools\make-audio.ps1
# Keep the phrases in sync with CLIPS in js/audio.js.
# Only record some:  ... -File tools\make-audio.ps1 -Only hold,relax

param([string]$Voice = 'Microsoft Zira Desktop', [int]$Rate = 0, [string[]]$Only = @())

Add-Type -AssemblyName System.Speech

$out = Join-Path $PSScriptRoot '..\audio'
New-Item -ItemType Directory -Force $out | Out-Null

$clips = [ordered]@{
  warmup    = 'Warm up. Brisk walk.'
  run       = 'Run. Easy pace.'
  run5k     = 'Run. Easy pace, all the way to five K.'
  walk      = 'Walk.'
  cooldown  = 'Cool down. Easy walk.'
  halfway   = 'Halfway there.'
  oneminute = 'One minute to go.'
  done      = 'Workout complete. Nice work.'
  paused    = 'Paused.'
  resumed   = 'Resuming.'
  test      = 'Voice check. This is how loud your cues will be.'
  m5        = 'Five minutes.'
  m10       = 'Ten minutes.'
  m15       = 'Fifteen minutes.'
  m20       = 'Twenty minutes.'
  m25       = 'Twenty-five minutes.'
  m30       = 'Thirty minutes.'
  m35       = 'Thirty-five minutes.'
  m40       = 'Forty minutes.'
  hold      = 'Hold.'
  relax     = 'Relax.'
  switch    = 'Switch sides.'
  next      = 'Next exercise.'
  restover  = 'Rest over. Next set.'
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($Voice)
$synth.Rate = $Rate
$synth.Volume = 100
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

$Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$names = @($clips.Keys | Where-Object { $Only.Count -eq 0 -or $Only -contains $_ })
foreach ($name in $names) {
  $path = Join-Path $out "$name.wav"
  $synth.SetOutputToWaveFile($path, $format)
  $synth.Speak($clips[$name])
  $synth.SetOutputToNull()
  '{0,-10} {1,6:N0} bytes' -f $name, (Get-Item $path).Length
}
$synth.Dispose()

# Trim the silence Windows pads around each clip.
node (Join-Path $PSScriptRoot 'trim-audio.mjs') @names
