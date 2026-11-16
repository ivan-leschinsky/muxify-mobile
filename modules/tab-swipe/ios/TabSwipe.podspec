Pod::Spec.new do |s|
  s.name = 'TabSwipe'
  s.version = '1.0.0'
  s.summary = 'Muxify swipe between the tabs of a screen'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Muxify'
  s.homepage = 'https://github.com/evgeny/muxify'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
