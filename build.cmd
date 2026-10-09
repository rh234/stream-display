@echo off
setlocal
set "STREAM_DISPLAY_SCRIPT=%~f0"
set "STREAM_DISPLAY_ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$text=[IO.File]::ReadAllText($env:STREAM_DISPLAY_SCRIPT); & ([scriptblock]::Create(($text -split '(?m)^# POWERSHELL\r?$',2)[1]))"
set "result=%errorlevel%"
if not defined STREAM_DISPLAY_NO_PAUSE pause
exit /b %result%
# POWERSHELL
$SourceZip = $env:STREAM_DISPLAY_SOURCE

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = $env:STREAM_DISPLAY_ROOT
$work = Join-Path $root '.build'

try
{
	Add-Type -AssemblyName System.IO.Compression.FileSystem
	New-Item -ItemType Directory -Path $work -Force | Out-Null

	$node = Get-Command node.exe -ErrorAction SilentlyContinue
	$corepack = Get-Command corepack.cmd -ErrorAction SilentlyContinue
	$compatible = $false

	if ( $node -and $corepack )
	{
		$version = & $node.Source --version
		$major = ( [version] $version.TrimStart( 'v' ) ).Major
		$compatible = [int] $major -ge 22
	}

	if ( -not $compatible )
	{
		Write-Host 'getting node.js...'
		$sums = ( Invoke-WebRequest 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt' -UseBasicParsing ).Content
		$match = [regex]::Match( $sums, '(?m)^([a-f0-9]{64})\s+(node-v22\.[\d.]+-win-x64\.zip)\s*$' )

		if ( -not $match.Success )
		{
			throw 'cant find the node.js download'
		}

		$archive = Join-Path $work $match.Groups[2].Value
		$nodeDir = Join-Path $work ( [IO.Path]::GetFileNameWithoutExtension( $archive ) )

		if ( -not ( Test-Path -LiteralPath "$nodeDir\node.exe" ) )
		{
			Invoke-WebRequest ( 'https://nodejs.org/dist/latest-v22.x/' + $match.Groups[2].Value ) -OutFile $archive -UseBasicParsing

			if ( ( Get-FileHash -LiteralPath $archive -Algorithm SHA256 ).Hash -ne $match.Groups[1].Value )
			{
				throw 'node.js download looks broken. try again'
			}

			[IO.Compression.ZipFile]::ExtractToDirectory( $archive, $work )
		}

		$env:PATH = $nodeDir + ';' + $env:PATH
	}

	$source = Join-Path $work 'Vencord-main'

	if ( -not ( Test-Path -LiteralPath "$source\package.json" ) )
	{
		if ( -not $SourceZip )
		{
			Write-Host 'getting vencord source...'
			$SourceZip = Join-Path $work 'Vencord-source.zip'
			Invoke-WebRequest 'https://github.com/rh234/stream-display/releases/latest/download/Vencord-source.zip' -OutFile $SourceZip -UseBasicParsing
		}

		[IO.Compression.ZipFile]::ExtractToDirectory( ( Resolve-Path -LiteralPath $SourceZip ).Path, $work )
	}

	$plugin = Join-Path $source 'src\userplugins\forceStreamAspectRatio'
	New-Item -ItemType Directory -Path $plugin -Force | Out-Null
	Copy-Item -LiteralPath ( Join-Path $root 'index.tsx' ) -Destination "$plugin\index.tsx" -Force

	Push-Location $source

	try
	{
		$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
		Write-Host 'installing dependencies...'
		& corepack.cmd pnpm install --frozen-lockfile

		if ( $LASTEXITCODE -ne 0 )
		{
			throw 'couldnt install dependencies'
		}

		$env:VENCORD_HASH = 'stream-display'
		$env:VENCORD_REMOTE = 'Vendicated/Vencord'
		Write-Host 'building...'
		& node.exe scripts/build/build.mjs --standalone --disable-updater

		if ( $LASTEXITCODE -ne 0 )
		{
			throw 'build failed'
		}

		$output = Join-Path $root 'dist'
		New-Item -ItemType Directory -Path $output -Force | Out-Null
		Copy-Item -Path '.\dist\*' -Destination $output -Force
		Write-Host "done. files: $output" -ForegroundColor Green
	}
	finally
	{
		Pop-Location
	}
}
catch
{
	Write-Host $_.Exception.Message -ForegroundColor Red
	Write-Host 'check your connection. Vencord-source.zip needs to be in the github release'
	exit 1
}
